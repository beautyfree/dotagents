# Everyday workflows

This guide contains the deeper operational detail behind the short path in the
project README. Every command either previews a plan or applies a plan you have
already reviewed.

## Start a personal library

```sh
dotagents setup
```

`setup` uses `~/.agents` by default. It discovers compatible agent folders,
keeps verified Skills CLI packages as source references, and leaves uncertain
or unsafe folders on the current machine.

After its one confirmation, setup connects compatible empty agent folders
safely. You can repeat that connection later whenever you install another
agent:

```sh
dotagents connect
```

Preview without changing anything:

```sh
dotagents setup --dry-run
```

Save a portable review artifact for a teammate or automation:

```sh
dotagents setup --out setup-plan.json
dotagents apply setup-plan.json --yes
```

## Keep the library in Git

After setup has connected a repository, everyday updates need no path or URL:

```sh
dotagents sync
```

Sync uses the remembered `~/.agents` library and remote. It reviews portable
files, creates a commit when needed, and pushes after one confirmation.

## Restore on another computer

On a new computer, use setup to connect your existing library:

```sh
dotagents setup
```

The setup flow either identifies the remote library before it writes
`~/.agents`, or lets you review the exact name of a new private GitHub/GitLab
library before it is created. GitHub/GitLab use one browser Device Flow sign-in,
then keep its token in the operating system credential vault. You can select an
existing library without remembering its URL, and later sync without `gh`,
`glab`, a URL, or a folder argument. It then safely connects compatible agents and refuses to
replace an existing library. A self-hosted server is configured by entering its
credential-free Git URL once; later syncs reuse it locally.

## Check before sharing

```sh
dotagents doctor ~/.agents
dotagents audit ~/.agents --public
```

Secret findings identify a file and rule, but never print a matched value.

## When something needs attention

```sh
dotagents status ~/.agents
dotagents status ~/.agents --json
```

The human view gives a concise health summary. `--json` has the exact managed
paths for tooling or careful troubleshooting.

## Source trust

Network operations are denied unless you explicitly trust a source. For the
complete policy and advanced options, run:

```sh
dotagents --help
```

This separation is intentional: provider sign-in and repository listing happen
only during interactive setup through the provider's native Device Flow.
dotagents never fetches library content until an exact source has been selected
and reviewed. An automated run cannot broaden content trust by accident.
