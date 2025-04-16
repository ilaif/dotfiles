-- Pull in the wezterm API
local wezterm = require("wezterm")

-- This will hold the configuration.
local config = wezterm.config_builder()

-- This is where you actually apply your config choices

-- For example, changing the color scheme:
config.color_scheme = "Catppuccin Mocha"

config.font = wezterm.font("JetBrainsMono Nerd Font", { weight = "Bold" })
config.font_size = 14.0
config.window_background_opacity = 0.95

-- default window size
config.initial_rows = 40
config.initial_cols = 120

-- and finally, return the configuration to wezterm
return config
