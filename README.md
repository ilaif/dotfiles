# Dotfiles

## Getting started

1. First things first, setup various mac settings: `make mac-setup`
2. Bootstrap chezmoi to install all dotfiles and dev packages: `make bootstrap-chezmoi`

## To pull the latest changes and apply them

```sh
chezmoi update
```

## Daily commands - for using chezmoi

```sh
chezmoi add $FILE           # adds $FILE from your home directory to the source directory.
chezmoi edit $FILE          # opens your editor with the file in the source directory that corresponds to $FILE.
chezmoi status              # gives a quick summary of what files would change if you ran chezmoi apply.
chezmoi diff                # shows the changes that chezmoi apply would make to your home directory.
chezmoi apply               # updates your dotfiles from the source directory.
chezmoi edit --apply $FILE  # is like chezmoi edit $FILE but also runs chezmoi apply $FILE afterwards.
chezmoi cd                  # opens a subshell in the source directory.
```

## Update global devbox package

```sh
devbox global add <package>
chezmoi re-add $HOME/.local/share/devbox/  # refresh it to sync with the rest
```
