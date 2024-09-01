#!/bin/bash

set -e

echox() {
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

echox "#########################"
echox "# Welcome to MAC setup! #"
echox "#########################"
echo ""

echox "Updating OSX. If this requires a restart, run the script again."
sudo softwareupdate -ia

echox "Configuring macOS"

echox "Faster key repeat"
defaults write -g InitialKeyRepeat -int 15
defaults write -g KeyRepeat -int 1

echox "Require password as soon as screensaver or sleep mode starts"
defaults write com.apple.screensaver askForPassword -int 1
defaults write com.apple.screensaver askForPasswordDelay -int 0

echox "Show filename extensions by default"
defaults write NSGlobalDomain AppleShowAllExtensions -bool true

echox "Enable tap-to-click"
defaults write com.apple.driver.AppleBluetoothMultitouch.trackpad Clicking -bool true
defaults -currentHost write NSGlobalDomain com.apple.mouse.tapBehavior -int 1

echox "Disable natural scroll"
defaults write NSGlobalDomain com.apple.swipescrolldirection -bool false

echox "Disable smart quotes"
defaults write NSGlobalDomain NSAutomaticQuoteSubstitutionEnabled -bool false

echox "Disable smart dashes"
defaults write NSGlobalDomain NSAutomaticDashSubstitutionEnabled -bool false

echox "Enable full keyboard access for all controls"
defaults write NSGlobalDomain AppleKeyboardUIMode -int 3

echox "Automatically hide and show the Dock"
defaults write com.apple.dock autohide -bool true

echox "Make showing the dock faster"
defaults write com.apple.Dock autohide-delay -float 0
defaults write com.apple.dock autohide-time-modifier -float 0.4
killall Dock

echox "Make window resizing animations faster"
defaults write -g NSWindowResizeTime -float 0.003

echox "Disable opening and closing window animations"
defaults write NSGlobalDomain NSAutomaticWindowAnimationsEnabled -bool false

echox "Only use UTF-8 in Terminal.app"
defaults write com.apple.terminal StringEncodings -array 4

echox "Installing Xcode Command Line Tools"
xcode-select --install || true

echo ""
echox "Mac setup complete ✅"
echo ""

DO_LOGOUT=n
question "You need to logout to apply some of the changes. Do you want to logout now?" DO_LOGOUT
if [ "$DO_LOGOUT" = "y" ]; then
  osascript -e 'tell application "System Events" to log out'
fi
