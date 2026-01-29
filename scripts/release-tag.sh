#!/bin/bash

if git rev-parse $1 >/dev/null 2>&1; then 
	read -p "Tag $1 exists. Delete and recreate? (y/N): " yn;
	if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
		git tag -d $1
		git push origin :$1 
	else
		echo 'Cancelled.'
		exit 1
	fi
fi

git tag -f $1
git push origin $1
