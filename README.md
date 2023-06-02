<!-- find repos from template -->

For this Actions, an org token is required. It will create a csv which will show all the repos that are created from the repo that has been input.

The syntax for the repo input should be with the owner: `octo-org/monalisa-repo`

```yml
name: Repos from template
on:
  workflow_dispatch:
    inputs:
      repo-name:
        description: 'Name of the repository to find templates for'
        required: true
      org:
         required: false
jobs:
  find-repos-from-template:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2
      - name: Get repos from template
        uses: trojan-actions/repo-templates-report@main
        with:
          token: ${{ secrets.ORG_TOKEN }}
          repoName: ${{ github.event.inputs.repo-name }}
```