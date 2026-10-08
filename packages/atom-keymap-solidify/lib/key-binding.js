(function() {
  var KeyBinding, MATCH_TYPES, MODIFIERS, calculateSpecificity, isKeyup, _ref;

  _ref = require('./helpers'), calculateSpecificity = _ref.calculateSpecificity, MODIFIERS = _ref.MODIFIERS, isKeyup = _ref.isKeyup;

  MATCH_TYPES = {
    EXACT: 'exact',
    PARTIAL: 'partial',
    PENDING_KEYUP: 'pendingKeyup'
  };

  module.exports.MATCH_TYPES = MATCH_TYPES;

  module.exports.KeyBinding = KeyBinding = (function() {
    KeyBinding.currentIndex = 1;

    KeyBinding.prototype.enabled = true;

    function KeyBinding(source, command, keystrokes, selector, priority) {
      this.source = source;
      this.command = command;
      this.keystrokes = keystrokes;
      this.priority = priority;
      this.keystrokeArray = this.keystrokes.split(' ');
      this.keystrokeCount = this.keystrokeArray.length;
      this.selector = selector.replace(/!important/g, '');
      this.specificity = calculateSpecificity(selector);
      this.index = this.constructor.currentIndex++;
      this.cachedKeyups = null;
    }

    KeyBinding.prototype.matches = function(keystroke) {
      var multiKeystroke;
      multiKeystroke = /\s/.test(keystroke);
      if (multiKeystroke) {
        return keystroke === this.keystroke;
      } else {
        return keystroke.split(' ')[0] === this.keystroke.split(' ')[0];
      }
    };

    KeyBinding.prototype.compare = function(keyBinding) {
      if (keyBinding.priority === this.priority) {
        if (keyBinding.specificity === this.specificity) {
          return keyBinding.index - this.index;
        } else {
          return keyBinding.specificity - this.specificity;
        }
      } else {
        return keyBinding.priority - this.priority;
      }
    };

    KeyBinding.prototype.getKeyups = function() {
      var i, keystroke, _i, _len, _ref1;
      if (this.cachedKeyups != null) {
        return this.cachedKeyups;
      }
      _ref1 = this.keystrokeArray;
      for (i = _i = 0, _len = _ref1.length; _i < _len; i = ++_i) {
        keystroke = _ref1[i];
        if (isKeyup(keystroke)) {
          return this.cachedKeyups = this.keystrokeArray.slice(i);
        }
      }
    };

    KeyBinding.prototype.matchesKeystrokes = function(userKeystrokes) {
      var bindingKeystroke, bindingKeystrokeIndex, bindingRemainderContainsOnlyKeyups, doesMatch, isPartialMatch, matchesNextUserKeystroke, userKeystrokeIndex, userKeystrokesHasKeydownEvent, _i, _len, _ref1;
      userKeystrokeIndex = -1;
      userKeystrokesHasKeydownEvent = false;
      matchesNextUserKeystroke = function(bindingKeystroke) {
        var isKeydownEvent, userKeystroke;
        while (userKeystrokeIndex < userKeystrokes.length - 1) {
          userKeystrokeIndex += 1;
          userKeystroke = userKeystrokes[userKeystrokeIndex];
          isKeydownEvent = !isKeyup(userKeystroke);
          if (isKeydownEvent) {
            userKeystrokesHasKeydownEvent = true;
          }
          if (bindingKeystroke === userKeystroke) {
            return true;
          } else if (isKeydownEvent) {
            return false;
          }
        }
        return null;
      };
      isPartialMatch = false;
      bindingRemainderContainsOnlyKeyups = true;
      bindingKeystrokeIndex = 0;
      _ref1 = this.keystrokeArray;
      for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
        bindingKeystroke = _ref1[_i];
        if (!isPartialMatch) {
          doesMatch = matchesNextUserKeystroke(bindingKeystroke);
          if (doesMatch === false) {
            return false;
          } else if (doesMatch === null) {
            if (userKeystrokesHasKeydownEvent) {
              isPartialMatch = true;
            } else {
              return false;
            }
          }
        }
        if (isPartialMatch) {
          if (!isKeyup(bindingKeystroke)) {
            bindingRemainderContainsOnlyKeyups = false;
          }
        }
      }
      if (userKeystrokeIndex < userKeystrokes.length - 1) {
        return false;
      }
      if (isPartialMatch && bindingRemainderContainsOnlyKeyups) {
        return MATCH_TYPES.PENDING_KEYUP;
      } else if (isPartialMatch) {
        return MATCH_TYPES.PARTIAL;
      } else {
        return MATCH_TYPES.EXACT;
      }
    };

    return KeyBinding;

  })();

}).call(this);
