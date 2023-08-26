#!/bin/sh

if [ -z "$1" ]; then
    echo "Missing argument.
    Usage: $0 <repo_name>"
    exit 1
fi

reg_repo=$(ls -d -1 $HOME/git/*/* | grep -i "$1" | head -1)

if [ ! -z $reg_repo ]; then
    code $reg_repo
    echo "Launching repo $reg_repo"
else
    echo "Not found"
fi
