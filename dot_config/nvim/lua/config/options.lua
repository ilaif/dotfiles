-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

-- Mouse-first / CUA editing (the engine behind :behave mswin, which Neovim dropped).
-- Shift+arrow starts a selection; typing over a selection replaces it (notepad feel).
vim.opt.mouse = "a" -- mouse in every mode (click to place cursor, drag to select)
vim.opt.selectmode = "mouse,key" -- mouse-drag and shift+motion enter Select mode
vim.opt.keymodel = "startsel,stopsel" -- shift+arrow selects; unshifted motion clears it
vim.opt.clipboard = "unnamedplus" -- yank/paste use the system clipboard
vim.opt.virtualedit = "onemore" -- let the cursor sit past the last char, like a GUI editor
