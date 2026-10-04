-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- CUA / notepad-style shortcuts. Modes are kept intact: these live in insert,
-- visual, and select modes where the "normal editor" expectation applies, so
-- LazyVim's normal-mode keymaps, motions, and `:` commands stay untouched.
-- Note: <C-s> (save) is already provided by LazyVim.
local map = vim.keymap.set

-- Copy / cut the selection (visual + select mode) -> system clipboard.
map({ "v", "s" }, "<C-c>", '"+y', { desc = "Copy selection" })
map({ "v", "s" }, "<C-x>", '"+d', { desc = "Cut selection" })

-- Paste from the system clipboard.
map("i", "<C-v>", "<C-r>+", { desc = "Paste" }) -- insert mode
map({ "v", "s" }, "<C-v>", '"+p', { desc = "Paste over selection" }) -- replace selection
map("c", "<C-v>", "<C-r>+", { desc = "Paste" }) -- command line
-- Normal-mode <C-v> is intentionally left as visual-block.

-- Select all.
map("n", "<C-a>", "ggVG", { desc = "Select all" })
map("i", "<C-a>", "<Esc>ggVG", { desc = "Select all" })

-- Undo / redo.
map("n", "<C-z>", "u", { desc = "Undo" })
map("i", "<C-z>", "<C-o>u", { desc = "Undo" })
map("n", "<C-y>", "<C-r>", { desc = "Redo" })
map("i", "<C-y>", "<C-o><C-r>", { desc = "Redo" })

-- Enter/exit modes with the mouse: a click already places the cursor via mouse=a.
-- Keep typing without pressing `i` by using the "you can just type" reflex —
-- selection-first: type over a shift-selected range to replace it.
