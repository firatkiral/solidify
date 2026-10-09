export default {
    "[command='center-circle'] solidify-viewport": {
        "v": "gizmo:circle:mode",
    },

    "[command='edit-circle'] solidify-viewport": {
        "d": "gizmo:circle:radius",
    },

    "[command='edit-center-point-arc'] solidify-viewport": {
        "d": "gizmo:arc:length",
        "f": "gizmo:arc:angle",
    },

    "[command='edit-three-point-arc'] solidify-viewport": {
        "d": "gizmo:arc:length",
        "f": "gizmo:arc:height",
    },

    "[command='edit-center-rectangle'] solidify-viewport, [command='edit-corner-rectangle'] solidify-viewport, [command='edit-three-point-rectangle'] solidify-viewport": {
        "d": "gizmo:rectangle:width",
        "f": "gizmo:rectangle:length",
    },

    "[command='corner-rectangle'] solidify-viewport, [command='center-rectangle'] solidify-viewport, [command='corner-box'] solidify-viewport, [command='center-box'] solidify-viewport": {
        "^alt": "keyboard:rectangle:mode",
    },

    "[command='polygon'] solidify-viewport, [command='edit-polygon'] solidify-viewport": {
        "shift-wheel+up": "gizmo:polygon:add-vertex",
        "shift-wheel+down": "gizmo:polygon:subtract-vertex",
        "v": "gizmo:polygon:mode",
    },

    "[command='edit-polygon'] solidify-viewport": {
        "d": "gizmo:polygon:diameter",
    },

    "[command='radial-array'] solidify-viewport, [command='rectangular-array'] solidify-viewport": {
        "shift-wheel+up": "gizmo:array:add",
        "shift-wheel+down": "gizmo:array:subtract",
    },

    "[command='rebuild'] solidify-viewport": {
        "shift-wheel+up": "gizmo:rebuild:forward",
        "shift-wheel+down": "gizmo:rebuild:backward",
    },

    "[command='spiral'] solidify-viewport": {
        "a": "gizmo:spiral:angle",
        "d": "gizmo:spiral:length",
        "r": "gizmo:spiral:radius",
    },

    "[command='revolution'] solidify-viewport": {
        "a": "gizmo:revolution:angle",
        "t": "gizmo:revolution:thickness",
    },

    "[command='loft'] solidify-viewport": {
        "t": "gizmo:loft:thickness",
    },

    "[command='evolution'] solidify-viewport": {
        "a": "gizmo:revolution:angle",
        "t": "gizmo:revolution:thickness",
    },

    "[command='pipe'] solidify-viewport": {
        "d": "gizmo:pipe:section-size",
        "t": "gizmo:pipe:thickness",
        "a": "gizmo:pipe:angle",

        "q": "keyboard:pipe:union",
        "w": "keyboard:pipe:difference",
        "e": "keyboard:pipe:intersect",
        "r": "keyboard:pipe:new-body",
    },

    "[command='boolean'] solidify-viewport": {
        "q": "gizmo:boolean:union",
        "w": "gizmo:boolean:difference",
        "e": "gizmo:boolean:intersect",

        "x": "gizmo:move:x",
        "y": "gizmo:move:y",
        "z": "gizmo:move:z",
        "shift-z": "gizmo:move:xy",
        "shift-x": "gizmo:move:yz",
        "shift-y": "gizmo:move:xz",
        "g": "gizmo:move:screen",
    },

    "[command='center-box'] solidify-viewport, [command='corner-box'] solidify-viewport, [command='three-point-box'] solidify-viewport": {
        "q": "keyboard:box:union",
        "w": "keyboard:box:difference",
        "e": "keyboard:box:intersect",
        "r": "keyboard:box:new-body",

        "d": "gizmo:box:width",
        "f": "gizmo:box:length",
        "h": "gizmo:box:height",
    },

    "[command='cylinder'] solidify-viewport": {
        "q": "keyboard:cylinder:union",
        "w": "keyboard:cylinder:difference",
        "e": "keyboard:cylinder:intersect",
        "r": "keyboard:cylinder:new-body",

        "d": "gizmo:cylinder:height",
        "f": "gizmo:cylinder:radius",
    },

    "[command='sphere'] solidify-viewport": {
        "q": "keyboard:sphere:union",
        "w": "keyboard:sphere:difference",
        "e": "keyboard:sphere:intersect",
        "r": "keyboard:sphere:new-body",

        "d": "gizmo:sphere:radius",
    },

    "[command='extrude'] solidify-viewport": {
        "a": "gizmo:extrude:race1",
        "s": "keyboard:extrude:symmetric",
        "d": "gizmo:extrude:distance1",
        "t": "gizmo:extrude:thickness",

        "q": "keyboard:extrude:union",
        "w": "keyboard:extrude:difference",
        "e": "keyboard:extrude:intersect",
        "r": "keyboard:extrude:new-body",

        "f": "keyboard:extrude:free",
        "v": "keyboard:extrude:pivot"
    },

    "[command='offset-face'] solidify-viewport": {
        "d": "gizmo:offset-face:distance",
        "a": "gizmo:offset-face:angle",
        "q": "gizmo:offset-face:toggle",
    },

    "[command='refillet-face'] solidify-viewport": {
        "d": "gizmo:refillet-face:distance",
    },

    "[command='offset-curve'] solidify-viewport": {
        "d": "gizmo:offset-curve:distance",
        "v": "keyboard:offset-curve:gap-fill",
    },

    "[command='bridge-curves'] solidify-viewport": {
        "q": "keyboard:bridge-curves:trim",
        "d": "gizmo:bridge-curves:tension",
    },

    // More specific than the Tab quasimode binding below, so Tab cycles continuity instead
    "body[command='bridge-curves']:not([gizmo]):not([quasimode]) solidify-viewport": {
        "tab": "keyboard:bridge-curves:cycle",
    },

    "[command='move'] solidify-viewport, [command='move-item'] solidify-viewport, [command='move-empty'] solidify-viewport, [command='duplicate'] solidify-viewport, [command='move-control-point'] solidify-viewport, [command='action-face'] solidify-viewport": {
        "x": "gizmo:move:x",
        "y": "gizmo:move:y",
        "z": "gizmo:move:z",
        "shift-z": "gizmo:move:xy",
        "shift-x": "gizmo:move:yz",
        "shift-y": "gizmo:move:xz",
        "g": "gizmo:move:screen",

        "f": "keyboard:move:free",
        "v": "keyboard:move:pivot"
    },

    "[command='scale'] solidify-viewport, [command='scale-item'] solidify-viewport, [command='scale-empty'] solidify-viewport, [command='scale-control-point'] solidify-viewport": {
        "x": "gizmo:scale:x",
        "y": "gizmo:scale:y",
        "z": "gizmo:scale:z",
        "shift-z": "gizmo:scale:xy",
        "shift-x": "gizmo:scale:yz",
        "shift-y": "gizmo:scale:xz",
        "s": "gizmo:scale:xyz",
        "f": "keyboard:scale:free",
        "v": "keyboard:scale:pivot"
    },

    "[command='fillet-solid'] solidify-viewport": {
        "v": "gizmo:fillet-solid:add",
        "d": "gizmo:fillet-solid:fillet",
        "c": "gizmo:fillet-solid:chamfer",
        "a": "gizmo:fillet-solid:angle",
    },

    "[command='modify-contour'] solidify-viewport": {
        "d": "gizmo:modify-contour:fillet-all",
    },

    "[command='rotate'] solidify-viewport, [command='rotate-item'] solidify-viewport, [command='rotate-empty'] solidify-viewport, [command='rotate-control-point'] solidify-viewport, [command='draft-solid'] solidify-viewport": {
        "x": "gizmo:rotate:x",
        "y": "gizmo:rotate:y",
        "z": "gizmo:rotate:z",
        "r": "gizmo:rotate:screen",
        "f": "keyboard:rotate:free",
        "v": "keyboard:rotate:pivot"
    },

    "[command='curve'] solidify-viewport": {
        "1": "gizmo:curve:hermite",
        "2": "gizmo:curve:bezier",
        "3": "gizmo:curve:nurbs",
        "4": "gizmo:curve:cubic-spline",
        "cmd-z": "gizmo:curve:undo",
        "ctrl-z": "gizmo:curve:undo",
    },

    "[command='line'] solidify-viewport": {
        "cmd-z": "gizmo:line:undo",
        "ctrl-z": "gizmo:line:undo",
    },

    "[command='mirror'] solidify-viewport": {
        "x": "gizmo:mirror:x",
        "y": "gizmo:mirror:y",
        "z": "gizmo:mirror:z",
        "shift-x": "gizmo:mirror:-x",
        "shift-y": "gizmo:mirror:-y",
        "shift-z": "gizmo:mirror:-z",
        "f": "gizmo:mirror:free",
        "v": "gizmo:mirror:pivot",
    },

    "[command='thin-solid'] solidify-viewport": {
        "d": "gizmo:thin-solid:thickness",
    },

    "[command='place'] solidify-viewport": {
        "d": "gizmo:place:offset",
        "f": "gizmo:place:flip",
        "a": "gizmo:place:angle",
        "s": "gizmo:place:scale",
    },

    "body:not([gizmo]) solidify-viewport, body[gizmo='point-picker'] solidify-viewport": {
        "numpad1": "viewport:navigate:front",
        "numpad3": "viewport:navigate:right",
        "numpad7": "viewport:navigate:top",

        "ctrl-numpad1": "viewport:navigate:back",
        "ctrl-numpad3": "viewport:navigate:left",
        "ctrl-numpad7": "viewport:navigate:bottom",

        "numpad5": "viewport:toggle-orthographic",
    },

    "solidify-viewport": {
        "space": "viewport:navigate:selection",
        "shift-space": "viewport:grid:selection",
        "ctrl-space": "command:create-viewspace-construction-plane-at-origin",
        "ctrl-shift-space": "command:create-viewspace-construction-plane",
        "alt-z": "viewport:toggle-x-ray",
        "shift-alt-z": "viewport:toggle-overlays",
    },

    "body:not([gizmo])": {
        "1": "selection:mode:set:control-point",
        "2": "selection:mode:set:edge",
        "3": "selection:mode:set:face",
        "4": "selection:mode:set:solid",
        "tab": "selection:mode:set:all",
        "5": "selection:mode:set:all",

        "ctrl-1": "selection:convert:control-point",
        "ctrl-2": "selection:convert:edge",
        "ctrl-3": "selection:convert:face",
        "ctrl-4": "selection:convert:solid",

        "shift-1": "selection:mode:toggle:control-point",
        "shift-2": "selection:mode:toggle:edge",
        "shift-3": "selection:mode:toggle:face",
        "shift-4": "selection:mode:toggle:solid",

        "c": "command:cut",
        "j": "command:join-curves",
        "g": "command:move",
        "r": "command:rotate",
        "s": "command:scale",
        "shift-p": "command:evolution",
        "p": "command:pipe",
        "b": "command:fillet-solid",
        "e": "command:extrude",
        "alt-e": "command:evolution",
        "t": "command:trim",
        "o": "command:offset-curve",
        "alt-x": "command:mirror",
        "l": "command:loft",

        "x": "command:delete",
        "delete": "command:delete",
        "backspace": "command:delete",

        "m": "command:set-material",
        "alt-m": "command:remove-material",

        "alt-q": "command:rebuild",
        "shift-d": "command:duplicate",
        "ctrl-d": "command:place",

        "shift-a": "command:line",
        "shift-s": "command:curve",

        "shift-z": "command:sphere",
        "shift-x": "command:cylinder",
        "shift-c": "command:corner-box",
        "shift-v": "command:center-box",

        "shift-q": "command:corner-rectangle",
        "shift-w": "command:center-circle",

        "q": "command:boolean",

        "h": "command:hide-selected",
        "shift-h": "command:hide-unselected",
        "alt-h": "command:unhide-all",
        "ctrl-h": "command:invert-hidden",

        "ctrl-g": "command:group-selected",
        "alt-g": "command:ungroup-selected",

        "shift-r": "edit:repeat-last-command",
        "cmd-z": "edit:undo",
        "cmd-shift-z": "edit:redo",
        "ctrl-z": "edit:undo",
        "ctrl-shift-z": "edit:redo",

        "ctrl-c": "edit:copy",
        "cmd-c": "edit:copy",
        "ctrl-v": "edit:paste",
        "cmd-v": "edit:paste",

        // Browsers keep cmd-n and ctrl-n for a new window
        "alt-shift-n": "file:new",
        "cmd-s": "file:save",
        "ctrl-s": "file:save",
        "cmd-shift-s": "file:save-as",
        "ctrl-shift-s": "file:save-as",
        "cmd-o": "file:open",
        "ctrl-o": "file:open",

        "alt-A": "command:deselect-all",
        "escape": "command:deselect-all",
    },

    "body:not([gizmo]) solidify-viewport": {
        "/": "viewport:focus",
    },

    "orbit-controls": {
        "mouse1": "orbit:rotate",
        "mouse2": "orbit:pan",
    },

    "viewport-selector": {
        "mouse0": "selection:replace",
        "shift-mouse0": "selection:add",
        "ctrl-mouse0": "selection:remove",
        
        "alt-shift-mouse0": "selection:add",
        "ctrl-alt-mouse0": "selection:add",
        
        "cmd": "selection:option:ignore-mode",
        "alt": "selection:option:extend",
    },

    "viewport-selector[quasimode]": {
        "mouse0": "selection:replace",
        "shift-mouse0": "selection:add",
        "ctrl-mouse0": "selection:remove",
    },

    "body[gizmo=point-picker]": {
        "n": "snaps:set-normal",
        "b": "snaps:set-binormal",
        "t": "snaps:set-tangent",
        "x": "snaps:set-x",
        "y": "snaps:set-y",
        "z": "snaps:set-z",
        "s": "snaps:set-square",

        "mouse2": "point-picker:finish",
        "enter": "point-picker:finish",
    },

    "body": {
        "alt": "noop",
        "escape": "menu:cancel",
    },

    "body[command] solidify-viewport": {
        "escape": "command:abort",
    },

    "body[command]:not([gizmo]) solidify-viewport": {
        "enter": "command:finish",
        "mouse2": "command:finish",

        "tab": "command:quasimode:start",
        "^tab": "command:quasimode:stop",
    },

    "body[command][gizmo]:not([gizmo='point-picker']) solidify-viewport": {
        "enter": "gizmo:finish", // for `sz0<enter>`, etc
    }
}