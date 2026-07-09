// Offline TipTap bundle for the Mosaic mobile shell (Care List editor).
// Bundles TipTap core + the exact extension set the desktop care-list uses
// (shepherding-care-list.js) plus prosemirror-state, into ONE IIFE with a
// SINGLE ProseMirror instance, exposed as window._TipTapLib. The screen glue
// then adds the custom FontSize extension and assigns window._TipTap, matching
// the desktop's setup so shepherding-inline-triggers.js works unchanged.
import { Editor, Extension, Node, InputRule, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Mention from "@tiptap/extension-mention";
import TextStyle from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";

window._TipTapLib = {
  Editor, Extension, Node, InputRule, mergeAttributes,
  Plugin, PluginKey,
  StarterKit, Underline, Mention, TextStyle, FontFamily, Highlight,
  Table, TableRow, TableHeader, TableCell,
};
