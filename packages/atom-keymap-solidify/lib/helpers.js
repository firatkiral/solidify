(function() {
  var DIGIT_KEYS_BY_KEYBOARD_EVENT_CODE, ENDS_IN_MODIFIER_REGEX, KEY_NAMES_BY_KEYBOARD_EVENT_CODE, KeyboardLayout, LATIN_KEYMAP_CACHE, MODIFIERS, NON_CHARACTER_KEY_NAMES_BY_KEYBOARD_EVENT_KEY, NUMPAD_KEY_NAMES_BY_KEYBOARD_EVENT_CODE, WHITESPACE_REGEX, buildKeyboardEvent, calculateSpecificity, currentPlatform, isASCIICharacter, isKeyup, isLatinCharacter, isLatinKeymap, isLowerCaseCharacter, isNumericCharacter, isUpperCaseCharacter, keyboard, nonAltModifiedKeyForKeyboardEvent, normalizeKeystroke, parseKeystroke, slovakCmdCharactersForKeyCode, slovakCmdKeymap, slovakQwertyCmdKeymap, usCharactersForKeyCode, usKeymap;

  calculateSpecificity = require('clear-cut').calculateSpecificity;

  // The platform as Node names it: Node's own when there is one (as in the tests), otherwise from the browser
  currentPlatform = (function() {
    var platform;
    if (typeof process !== 'undefined' && process.platform) {
      return process.platform;
    }
    platform = typeof navigator !== 'undefined' ? (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '' : '';
    if (/^mac/i.test(platform)) {
      return 'darwin';
    }
    if (/^win/i.test(platform)) {
      return 'win32';
    }
    return 'linux';
  })();

  exports.currentPlatform = currentPlatform;

  // Only Chromium tells the keyboard layout; elsewhere alt-modified keys keep the character they type
  keyboard = typeof navigator !== 'undefined' ? navigator.keyboard : void 0;

  KeyboardLayout = null;

  if (keyboard != null) {
    keyboard.getLayoutMap().then(function(map) {
      return KeyboardLayout = map;
    });
  }

  MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'cmd']);

  ENDS_IN_MODIFIER_REGEX = /(ctrl|alt|shift|cmd)$/;

  WHITESPACE_REGEX = /\s+/;

  KEY_NAMES_BY_KEYBOARD_EVENT_CODE = {
    'Space': 'space',
    'Backspace': 'backspace'
  };

  NON_CHARACTER_KEY_NAMES_BY_KEYBOARD_EVENT_KEY = {
    'Control': 'ctrl',
    'Meta': 'cmd',
    'ArrowDown': 'down',
    'ArrowUp': 'up',
    'ArrowLeft': 'left',
    'ArrowRight': 'right'
  };

  NUMPAD_KEY_NAMES_BY_KEYBOARD_EVENT_CODE = {
    'Numpad0': 'numpad0',
    'Numpad1': 'numpad1',
    'Numpad2': 'numpad2',
    'Numpad3': 'numpad3',
    'Numpad4': 'numpad4',
    'Numpad5': 'numpad5',
    'Numpad6': 'numpad6',
    'Numpad7': 'numpad7',
    'Numpad8': 'numpad8',
    'Numpad9': 'numpad9'
  };

  DIGIT_KEYS_BY_KEYBOARD_EVENT_CODE = {
    'Digit0': '0',
    'Digit1': '1',
    'Digit2': '2',
    'Digit3': '3',
    'Digit4': '4',
    'Digit5': '5',
    'Digit6': '6',
    'Digit7': '7',
    'Digit8': '8',
    'Digit9': '9'
  };

  LATIN_KEYMAP_CACHE = new WeakMap();

  isLatinKeymap = function(keymap) {
    var isLatin;
    if (keymap == null) {
      return true;
    }
    isLatin = LATIN_KEYMAP_CACHE.get(keymap);
    if (isLatin != null) {
      return isLatin;
    } else {
      isLatin = ((keymap.KeyA == null) || isLatinCharacter(keymap.KeyA.unmodified)) && ((keymap.KeyS == null) || isLatinCharacter(keymap.KeyS.unmodified)) && ((keymap.KeyD == null) || isLatinCharacter(keymap.KeyD.unmodified)) && ((keymap.KeyF == null) || isLatinCharacter(keymap.KeyF.unmodified));
      LATIN_KEYMAP_CACHE.set(keymap, isLatin);
      return isLatin;
    }
  };

  isASCIICharacter = function(character) {
    return (character != null) && character.length === 1 && character.charCodeAt(0) <= 127;
  };

  isLatinCharacter = function(character) {
    return (character != null) && character.length === 1 && character.charCodeAt(0) <= 0x024F;
  };

  isUpperCaseCharacter = function(character) {
    return (character != null) && character.length === 1 && character.toLowerCase() !== character;
  };

  isLowerCaseCharacter = function(character) {
    return (character != null) && character.length === 1 && character.toUpperCase() !== character;
  };

  isNumericCharacter = function(character) {
    var _ref;
    return (character != null) && character.length === 1 && (48 <= (_ref = character.charCodeAt(0)) && _ref <= 57);
  };

  usKeymap = null;

  usCharactersForKeyCode = function(code) {
    if (usKeymap == null) {
      usKeymap = require('./us-keymap');
    }
    return usKeymap[code];
  };

  slovakCmdKeymap = null;

  slovakQwertyCmdKeymap = null;

  slovakCmdCharactersForKeyCode = function(code, layout) {
    if (slovakCmdKeymap == null) {
      slovakCmdKeymap = require('./slovak-cmd-keymap');
    }
    if (slovakQwertyCmdKeymap == null) {
      slovakQwertyCmdKeymap = require('./slovak-qwerty-cmd-keymap');
    }
    if (layout === 'com.apple.keylayout.Slovak') {
      return slovakCmdKeymap[code];
    } else {
      return slovakQwertyCmdKeymap[code];
    }
  };

  exports.normalizeKeystrokes = function(keystrokes) {
    var keystroke, normalizedKeystroke, normalizedKeystrokes, _i, _len, _ref;
    normalizedKeystrokes = [];
    _ref = keystrokes.split(WHITESPACE_REGEX);
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      keystroke = _ref[_i];
      if (normalizedKeystroke = normalizeKeystroke(keystroke)) {
        normalizedKeystrokes.push(normalizedKeystroke);
      } else {
        return false;
      }
    }
    return normalizedKeystrokes.join(' ');
  };

  normalizeKeystroke = function(keystroke) {
    var i, key, keys, keyup, modifiers, primaryKey, _i, _len;
    if (keyup = isKeyup(keystroke)) {
      keystroke = keystroke.slice(1);
    }
    keys = parseKeystroke(keystroke);
    if (!keys) {
      return false;
    }
    primaryKey = null;
    modifiers = new Set;
    for (i = _i = 0, _len = keys.length; _i < _len; i = ++_i) {
      key = keys[i];
      if (MODIFIERS.has(key)) {
        modifiers.add(key);
      } else {
        if (i === keys.length - 1) {
          primaryKey = key;
        } else {
          return false;
        }
      }
    }
    if (keyup) {
      if (primaryKey != null) {
        primaryKey = primaryKey.toLowerCase();
      }
    } else {
      if (isUpperCaseCharacter(primaryKey)) {
        modifiers.add('shift');
      }
    }
    keystroke = [];
    if (!keyup || (keyup && (primaryKey == null))) {
      if (modifiers.has('ctrl')) {
        keystroke.push('ctrl');
      }
      if (modifiers.has('alt')) {
        keystroke.push('alt');
      }
      if (modifiers.has('shift')) {
        keystroke.push('shift');
      }
      if (modifiers.has('cmd')) {
        keystroke.push('cmd');
      }
    }
    if (primaryKey != null) {
      keystroke.push(primaryKey);
    }
    keystroke = keystroke.join('-');
    if (keyup) {
      keystroke = "^" + keystroke;
    }
    return keystroke;
  };

  parseKeystroke = function(keystroke) {
    var character, index, keyStart, keys, _i, _len;
    keys = [];
    keyStart = 0;
    for (index = _i = 0, _len = keystroke.length; _i < _len; index = ++_i) {
      character = keystroke[index];
      if (character === '-') {
        if (index > keyStart) {
          keys.push(keystroke.substring(keyStart, index));
          keyStart = index + 1;
          if (keyStart === keystroke.length) {
            return false;
          }
        }
      }
    }
    if (keyStart < keystroke.length) {
      keys.push(keystroke.substring(keyStart));
    }
    return keys;
  };

  exports.keystrokeForKeyboardEvent = function(event, customKeystrokeResolvers) {
    var altKey, characters, code, ctrlKey, isAltModifiedKey, isNonCharacterKey, key, keystroke, metaKey, nonAltModifiedKey, shiftKey, _ref;
    key = event.key, code = event.code, ctrlKey = event.ctrlKey, altKey = event.altKey, shiftKey = event.shiftKey, metaKey = event.metaKey;
    if (NUMPAD_KEY_NAMES_BY_KEYBOARD_EVENT_CODE[code] != null) {
      key = NUMPAD_KEY_NAMES_BY_KEYBOARD_EVENT_CODE[code];
    }
    if (DIGIT_KEYS_BY_KEYBOARD_EVENT_CODE[code] != null) {
      key = DIGIT_KEYS_BY_KEYBOARD_EVENT_CODE[code];
    }
    if (KEY_NAMES_BY_KEYBOARD_EVENT_CODE[code] != null) {
      key = KEY_NAMES_BY_KEYBOARD_EVENT_CODE[code];
    }
    isAltModifiedKey = false;
    isNonCharacterKey = key.length > 1;
    if (isNonCharacterKey) {
      key = (_ref = NON_CHARACTER_KEY_NAMES_BY_KEYBOARD_EVENT_KEY[key]) != null ? _ref : key.toLowerCase();
      if (key === "altgraph" && currentPlatform === "win32") {
        key = "alt";
      }
    } else {
      key = key.toLowerCase();
      if (event.getModifierState('AltGraph') || (currentPlatform === 'darwin' && altKey)) {
        if (currentPlatform === 'darwin' && event.code) {
          nonAltModifiedKey = nonAltModifiedKeyForKeyboardEvent(event);
          if (nonAltModifiedKey && (ctrlKey || metaKey || !isASCIICharacter(key))) {
            key = nonAltModifiedKey;
          } else if (key !== nonAltModifiedKey) {
            altKey = false;
            isAltModifiedKey = true;
          }
        } else if (currentPlatform === 'win32' && event.code) {
          nonAltModifiedKey = nonAltModifiedKeyForKeyboardEvent(event);
          if (nonAltModifiedKey && (metaKey || !isASCIICharacter(key))) {
            key = nonAltModifiedKey;
          } else if (key !== nonAltModifiedKey) {
            ctrlKey = false;
            altKey = false;
            isAltModifiedKey = true;
          }
        } else if (currentPlatform === 'linux') {
          nonAltModifiedKey = nonAltModifiedKeyForKeyboardEvent(event);
          if (nonAltModifiedKey && (ctrlKey || altKey || metaKey)) {
            key = nonAltModifiedKey;
            altKey = event.getModifierState('AltGraph');
            isAltModifiedKey = !altKey;
          }
        }
      }
    }
    if (event.code && key.length === 1) {
      if (!isLatinCharacter(key)) {
        characters = usCharactersForKeyCode(event.code);
        if (event.shiftKey) {
          key = characters.withShift;
        } else if (characters.unmodified != null) {
          key = characters.unmodified;
        }
      }
    }
    keystroke = '';
    if (key === 'ctrl' || (ctrlKey && event.type !== 'keyup')) {
      keystroke += 'ctrl';
    }
    if (key === 'alt' || (altKey && event.type !== 'keyup')) {
      if (keystroke.length > 0) {
        keystroke += '-';
      }
      keystroke += 'alt';
    }
    if (key === 'shift' || shiftKey) {
      if (keystroke) {
        keystroke += '-';
      }
      keystroke += 'shift';
    }
    if (key === 'cmd' || (metaKey && event.type !== 'keyup')) {
      if (keystroke) {
        keystroke += '-';
      }
      keystroke += 'cmd';
    }
    if (!MODIFIERS.has(key)) {
      if (keystroke) {
        keystroke += '-';
      }
      keystroke += key;
    }
    if (event.type === 'keyup') {
      keystroke = normalizeKeystroke("^" + keystroke);
    }
    return keystroke;
  };

  nonAltModifiedKeyForKeyboardEvent = function(event) {
    var characters, match;
    if (event.code && KeyboardLayout != null && (characters = KeyboardLayout.get(event.code))) {
      return characters;
    }
    // Without the layout, as outside Chromium, letter and digit keys are taken to be where they are on QWERTY
    if (KeyboardLayout == null && event.code && (match = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code))) {
      return (match[1] || match[2]).toLowerCase();
    }
  };

  exports.MODIFIERS = MODIFIERS;

  exports.characterForKeyboardEvent = function(event) {
    if (event.key.length === 1 && !(event.ctrlKey || event.metaKey)) {
      return event.key;
    }
  };

  exports.calculateSpecificity = calculateSpecificity;

  exports.isBareModifier = function(keystroke) {
    return ENDS_IN_MODIFIER_REGEX.test(keystroke);
  };

  exports.isModifierKeyup = function(keystroke) {
    return isKeyup(keystroke) && ENDS_IN_MODIFIER_REGEX.test(keystroke);
  };

  exports.isKeyup = isKeyup = function(keystroke) {
    return keystroke.startsWith('^') && keystroke !== '^';
  };

  exports.keydownEvent = function(key, options) {
    return buildKeyboardEvent(key, 'keydown', options);
  };

  exports.keyupEvent = function(key, options) {
    return buildKeyboardEvent(key, 'keyup', options);
  };

  exports.getModifierKeys = function(keystroke) {
    var key, keys, mod_keys, _i, _len;
    keys = keystroke.split('-');
    mod_keys = [];
    for (_i = 0, _len = keys.length; _i < _len; _i++) {
      key = keys[_i];
      if (MODIFIERS.has(key)) {
        mod_keys.push(key);
      }
    }
    return mod_keys;
  };

  buildKeyboardEvent = function(key, eventType, _arg) {
    var alt, altKey, bubbles, cancelable, cmd, ctrl, ctrlKey, event, keyCode, location, metaKey, shift, shiftKey, target, _ref;
    _ref = _arg != null ? _arg : {}, ctrl = _ref.ctrl, shift = _ref.shift, alt = _ref.alt, cmd = _ref.cmd, keyCode = _ref.keyCode, target = _ref.target, location = _ref.location;
    ctrlKey = ctrl != null ? ctrl : false;
    altKey = alt != null ? alt : false;
    shiftKey = shift != null ? shift : false;
    metaKey = cmd != null ? cmd : false;
    bubbles = true;
    cancelable = true;
    event = new KeyboardEvent(eventType, {
      key: key,
      ctrlKey: ctrlKey,
      altKey: altKey,
      shiftKey: shiftKey,
      metaKey: metaKey,
      bubbles: bubbles,
      cancelable: cancelable
    });
    if (target != null) {
      Object.defineProperty(event, 'target', {
        get: function() {
          return target;
        }
      });
      Object.defineProperty(event, 'path', {
        get: function() {
          return [target];
        }
      });
    }
    return event;
  };

}).call(this);
