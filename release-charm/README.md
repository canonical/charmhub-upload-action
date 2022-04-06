# canonical/charming-actions/release-charm

This action is used to release an already uploaded charm to a different channel in charmhub. It is designed to be manually triggered with the inputs . The revision of the charm must be uploaded using `upload-charm` action. It updates the existing revision release tag with the destination channel and timestamp.

## Usage

```yaml
name: Release charm to other tracks and channels

on:
  workflow_dispatch:
    inputs:
      destination-channel:
        description: 'Destination Channel'
        required: true
      origin-channel:
        description: 'Origin Channel'
        required: false
      rev:
        description: 'Revision number'
        required: false

jobs:
  promote-charm:
    name: Promote charm
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Release charm to channel
        uses: canonical/charming-actions/release-charm@promote-charm
        with:
          credentials: ${{ secrets.CHARMCRAFT_CREDENTIALS }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          destination-channel: ${{ github.event.inputs.destination-channel }}
          origin-channel: ${{ github.event.inputs.origin-channel }}
          revision: ${{ github.event.inputs.rev }}
```

![Manual dispatch release charm action form screenshot](dispatch_release_action_form.png "Manual dispatch release charm action form screenshot")
## API

### Inputs

| Key                  | Description                                                                                             | Required |
| -------------------- | ------------------------------------------------------------------------------------------------------- | -------- | 
| `credentials`        | Credentials [exported](https://juju.is/docs/sdk/remote-env-auth) using `charmcraft login --export`.     | ✔️       |
| `github-token`       | Github Token needed for automatic tagging when publishing                                               | ✔️       |
| `destination-channel`| Channel to which the charm will be released. It must be in the format of `track/risk`.                  | ✔️       |
| `origin-channel`     | Origin Channel from where the charm that needs to be promoted will be pulled.                           |          |
| `revision`           | Revision number of charm that will be released. If this option is set `origin-channel` will be ignored. |          |
| `tag-prefix`         | Tag prefix, useful when bundling multiple charms in the same repo using a matrix.                       |          |     
| `charm-path`         | Path to the charm where `metadata.yaml` is located. Defaults to the current working directory.      |          |    
| `charmcraft-channel` | Snap channel to use when installing charmcraft. Defaults to `latest/edge`.                              |          |

### Outputs

None