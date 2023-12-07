import {
  debug,
  error,
  getInput,
  info,
  setFailed,
  warning,
} from '@actions/core';

import * as fs from 'fs';

import { Charmcraft, LibInfo, Snap, VersionInfo } from '../../services';
import { Change, LibrariesDiff, Outcomes, Tokens } from '../../types';

export class ReleaseLibrariesAction {
  private tokens: Tokens;
  private charmcraft: Charmcraft;
  private channel: string;
  private outcomes: Outcomes;
  private charmPath: string;
  private charmName: string;
  private charmNamePy: string;
  private snap: Snap;

  constructor() {
    this.tokens = {
      github: getInput('github-token'),
      charmhub: getInput('credentials'),
    };
    if (!this.tokens.github) {
      throw new Error(`Input 'github-token' is missing`);
    }
    this.charmPath = getInput('charm-path');
    this.channel = getInput('charmcraft-channel');

    this.outcomes = {
      fail: getInput('fail-build').toLowerCase() === 'true',
      comment: getInput('comment-on-pr').toLowerCase() === 'true',
      labels: false,
    };

    process.chdir(this.charmPath!);

    this.charmcraft = new Charmcraft(this.tokens.charmhub);
    this.charmName = this.charmcraft.metadata().name;
    this.charmNamePy = this.charmName.split('-').join('_'); // replace all
    this.snap = new Snap();
  }

  async run() {
    try {
      if (!this.ownsLibs()) {
        warning(`Charm ${this.charmName} has no own libs. Skipping action.`);
        return;
      }

      debug('installing charmcraft...');
      await this.snap.install('charmcraft', this.channel);

      const status = await this.getLibStatus();

      if (status.errors && status.errors.length > 0) {
        info(`Errors found during lib comparison.`);
        if (this.outcomes.fail) {
          setFailed('No changes committed. Please check the logs.');
          return;
        }
      }

      if (!status.changes.length) {
        info(`Nothing to update. Exiting...`);
        return;
      }

      info(`Publishing changes:\n${JSON.stringify(status.changes)}`);

      const failures = await this.publishLibs(status);

      if (failures.length) {
        setFailed(
          'Failed to publish some libs:\n\n' +
            `${failures.join('\n')}\n\n` +
            'See the logs for more info.',
        );
        return;
      }
      info('Successfully published libraries');
    } catch (e: any) {
      setFailed(e.message);
      error(e.stack);
    }
    debug('Execution completed.');
  }

  private parseCharmLibFile(
    data: string,
    versionInt: Number,
    version: string,
    libName: string,
  ): VersionInfo | Error {
    const libapiStr = data.match(/LIBAPI = (\d+)/i);
    if (!libapiStr) {
      return new Error(`no LIBAPI found in ${libName}`);
    }

    const LIBAPI = parseInt(libapiStr[1], 10);

    if (LIBAPI !== versionInt) {
      return new Error(`lib ${libName} declares LIBAPI=${LIBAPI} but is 
    under /${version}/. No good?`);
    }

    const libpatchStr = data.match(/LIBPATCH = (\d+)/i);

    if (!libpatchStr) {
      return new Error(`no LIBPATCH found in ${libName}`);
    }

    const LIBPATCH = parseInt(libpatchStr[1], 10);

    return {
      version: LIBAPI,
      revision: LIBPATCH,
    };
  }

  private async publishLibs(status: LibrariesDiff) {
    const failures: string[] = [];

    await Promise.all(
      status.changes.map(async (change: Change) => {
        const versionID: string = `v${change.new.major}`;
        info(`publishing ${change.libName}`);
        this.charmcraft
          .publishLib(this.charmNamePy, versionID, change.libName)
          .catch((reason) => {
            const msg: string = `publishing ${change.libName} (${change.new.major}.${change.new.major}) failures with reason=${reason}`;
            error(msg);
            failures.push(msg);
          });
      }),
    );
    return failures;
  }

  private getVersionInfo(
    libFile: string,
    versionInt: Number,
    version: string,
    libName: string,
  ): VersionInfo | Error {
    const data = fs.readFileSync(libFile, 'utf-8');
    return this.parseCharmLibFile(data, versionInt, version, libName);
  }

  async getCharmLibs(): Promise<LibInfo[]> {
    const libsFound: LibInfo[] = [];

    const versions: string[] = fs.readdirSync(
      `./lib/charms/${this.charmNamePy}/`,
    );
    versions.forEach((version: string) => {
      const versionInt = parseInt(version.slice(1), 10); // 'v1' --> 1
      const libs: string[] = fs.readdirSync(
        `./lib/charms/${this.charmNamePy}/${version}/`,
      );

      libs.forEach((libNamePy: string) => {
        const libName = libNamePy.slice(0, -3);
        const libFile = `./lib/charms/${this.charmNamePy}/${version}/${libNamePy}`;
        info(`found lib file: ${libFile}. Parsing...`);

        try {
          const vinfo = this.getVersionInfo(
            libFile,
            versionInt,
            version,
            libName,
          );
          if (vinfo instanceof Error) {
            error(
              `lib file could not be parsed: error ${vinfo.name} with msg = ${vinfo.message}`,
            );
          } else {
            libsFound.push({ libName, ...vinfo });
          }
        } catch (e: any) {
          setFailed(e.message);
          error(e.stack);
        }
      });
    });
    return libsFound;
  }

  private async getLibStatus(): Promise<LibrariesDiff> {
    const errors: string[] = [];
    const changes: Change[] = [];

    const remoteLibs = await this.charmcraft.listLib(this.charmName);
    const localLibs = await this.getCharmLibs();

    localLibs.forEach((localLib: LibInfo) => {
      info(`checking status for ${localLib.libName}`);

      const remoteLib: LibInfo | undefined = remoteLibs.find(
        (candidate: LibInfo) => candidate.libName === localLib.libName,
      );

      info(`remote lib: ${JSON.stringify(remoteLib)}`);

      if (!remoteLib) {
        changes.push({
          libName: localLib.libName,
          new: {
            minor: localLib.revision,
            major: localLib.version,
          },
        });
        info(`${localLib.libName} has no remote counterpart.`);
      } else if (this.isLibNewer(remoteLib, localLib)) {
        errors.push(
          `the local ${localLib.libName} is at ` +
            `${localLib.version}.${localLib.revision}, but ` +
            `${remoteLib.version}.${remoteLib.revision} is present on charmhub.`,
        );
        info(
          `${localLib.libName} has a lower version or revision than ${remoteLib.libName}`,
        );
      } else if (this.isLibDiffering(remoteLib, localLib)) {
        changes.push({
          libName: localLib.libName,
          old: {
            major: remoteLib.version,
            minor: remoteLib.revision,
          },
          new: {
            minor: localLib.revision,
            major: localLib.version,
          },
        });
        info(
          `${localLib.libName} will be updated from ${remoteLib.version}.${remoteLib.revision} to ${localLib.version}.${localLib.revision}`,
        );
      } else {
        info(`${localLib.libName} and ${remoteLib.libName} are equal`);
      }
    });
    return { errors, changes };
  }

  private isLibDiffering = (left: LibInfo, right: LibInfo): boolean =>
    left.revision !== right.revision || left.version !== right.version;

  private isLibNewer = (left: LibInfo, right: LibInfo): boolean =>
    left.revision > right.revision || left.version > right.version;

  private ownsLibs = () =>
    fs.existsSync('./lib') && fs.existsSync(`./lib/charms/${this.charmNamePy}`);
}
