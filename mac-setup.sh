#!/bin/bash

set -e

vecho() {
  printf "[\033[1;32mmac-setup\033[0m] %s\n" "$1"
}
question() {
  echo "$1"
  select yn in "yes" "no"; do
    case $yn in
    "yes")
      eval "$2=y"
      break
      ;;
    "no")
      eval "$2=n"
      break
      ;;
    esac
  done
}

vecho "#########################"
vecho "# Welcome to MAC setup! #"
vecho "#########################"
echo ""

vecho "Updating OSX. If this requires a restart, run the script again."
sudo softwareupdate -ia

vecho "Configuring macOS"

vecho "Faster key repeat"
defaults write -g InitialKeyRepeat -int 15
defaults write -g KeyRepeat -int 1

vecho "Require password as soon as screensaver or sleep mode starts"
defaults write com.apple.screensaver askForPassword -int 1
defaults write com.apple.screensaver askForPasswordDelay -int 0

vecho "Show filename extensions by default"
defaults write NSGlobalDomain AppleShowAllExtensions -bool true

vecho "Enable tap-to-click"
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad Clicking -bool true
defaults -currentHost write NSGlobalDomain com.apple.mouse.tapBehavior -int 1

vecho "Disable natural scroll"
defaults write NSGlobalDomain com.apple.swipescrolldirection -bool false

vecho "Disable smart quotes"
defaults write NSGlobalDomain NSAutomaticQuoteSubstitutionEnabled -bool false

vecho "Disable smart dashes"
defaults write NSGlobalDomain NSAutomaticDashSubstitutionEnabled -bool false

vecho "Enable full keyboard access for all controls"
defaults write NSGlobalDomain AppleKeyboardUIMode -int 3

vecho "Automatically hide and show the Dock"
defaults write com.apple.dock autohide -bool true

vecho "Make showing the dock faster"
defaults write com.apple.Dock autohide-delay -float 0
defaults write com.apple.dock autohide-time-modifier -float 0.4
killall Dock

vecho "Make window resizing animations faster"
defaults write -g NSWindowResizeTime -float 0.003

vecho "Disable opening and closing window animations"
defaults write NSGlobalDomain NSAutomaticWindowAnimationsEnabled -bool false

vecho "Only use UTF-8 in Terminal.app"
defaults write com.apple.terminal StringEncodings -array 4

vecho "Installing Xcode Command Line Tools"
xcode-select --install || true

echo ""
vecho "Mac setup complete ✅"
echo ""

DO_LOGOUT=n
question "You need to logout to apply some of the changes. Do you want to logout now?" DO_LOGOUT
if [ "$DO_LOGOUT" = "y" ]; then
  osascript -e 'tell application "System Events" to log out'
fi
