'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

module.exports = function () {
  function PartialKeyupMatcher() {
    _classCallCheck(this, PartialKeyupMatcher);

    this._pendingMatches = new Set();
  }

  _createClass(PartialKeyupMatcher, [{
    key: 'addPendingMatch',
    value: function addPendingMatch(keyBinding) {
      this._pendingMatches.add(keyBinding);
      keyBinding['nextKeyUpIndex'] = 0;
    }

    // Returns matching bindingss, if any.
    // Updates state for next match.

  }, {
    key: 'getMatches',
    value: function getMatches(userKeyupKeystroke) {
      userKeyupKeystroke = this._normalizeKeystroke(userKeyupKeystroke);
      var matches = new Set();

      // Loop over each pending keyup match.
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = this._pendingMatches[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var keyBinding = _step.value;

          var bindingKeystrokeToMatch = this._normalizeKeystroke(keyBinding.getKeyups()[keyBinding['nextKeyUpIndex']]);
          if (userKeyupKeystroke === bindingKeystrokeToMatch) {
            this._updateStateForMatch(matches, keyBinding);
          }
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator.return) {
            _iterator.return();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }

      return [].concat(_toConsumableArray(matches));
    }

    /** Private Section **/

  }, {
    key: '_normalizeKeystroke',
    value: function _normalizeKeystroke(keystroke) {
      if (keystroke[0] === '^') return keystroke.substring(1);
      return keystroke;
    }
  }, {
    key: '_updateStateForMatch',
    value: function _updateStateForMatch(matches, keyBinding) {
      if (keyBinding['nextKeyUpIndex'] === keyBinding.getKeyups().length - 1) {
        // Full match. Remove and return it.
        this._pendingMatches.delete(keyBinding);
        matches.add(keyBinding);
      } else {
        // Partial match. Increment what we're looking for next.
        keyBinding['nextKeyUpIndex']++;
      }
    }
  }]);

  return PartialKeyupMatcher;
}();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9wYXJ0aWFsLWtleXVwLW1hdGNoZXIuanMiXSwibmFtZXMiOlsibW9kdWxlIiwiZXhwb3J0cyIsIl9wZW5kaW5nTWF0Y2hlcyIsIlNldCIsImtleUJpbmRpbmciLCJhZGQiLCJ1c2VyS2V5dXBLZXlzdHJva2UiLCJfbm9ybWFsaXplS2V5c3Ryb2tlIiwibWF0Y2hlcyIsImJpbmRpbmdLZXlzdHJva2VUb01hdGNoIiwiZ2V0S2V5dXBzIiwiX3VwZGF0ZVN0YXRlRm9yTWF0Y2giLCJrZXlzdHJva2UiLCJzdWJzdHJpbmciLCJsZW5ndGgiLCJkZWxldGUiXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7QUFFQUEsT0FBT0MsT0FBUDtBQUdFLGlDQUFlO0FBQUE7O0FBQ2IsU0FBS0MsZUFBTCxHQUF1QixJQUFJQyxHQUFKLEVBQXZCO0FBQ0Q7O0FBTEg7QUFBQTtBQUFBLG9DQU9tQkMsVUFQbkIsRUFPK0I7QUFDM0IsV0FBS0YsZUFBTCxDQUFxQkcsR0FBckIsQ0FBeUJELFVBQXpCO0FBQ0FBLGlCQUFXLGdCQUFYLElBQStCLENBQS9CO0FBQ0Q7O0FBRUQ7QUFDQTs7QUFiRjtBQUFBO0FBQUEsK0JBY2NFLGtCQWRkLEVBY2tDO0FBQzlCQSwyQkFBcUIsS0FBS0MsbUJBQUwsQ0FBeUJELGtCQUF6QixDQUFyQjtBQUNBLFVBQUlFLFVBQVUsSUFBSUwsR0FBSixFQUFkOztBQUVBO0FBSjhCO0FBQUE7QUFBQTs7QUFBQTtBQUs5Qiw2QkFBeUIsS0FBS0QsZUFBOUIsOEhBQStDO0FBQUEsY0FBcENFLFVBQW9DOztBQUM3QyxjQUFNSywwQkFBMEIsS0FBS0YsbUJBQUwsQ0FDOUJILFdBQVdNLFNBQVgsR0FBdUJOLFdBQVcsZ0JBQVgsQ0FBdkIsQ0FEOEIsQ0FBaEM7QUFHQSxjQUFJRSx1QkFBdUJHLHVCQUEzQixFQUFvRDtBQUNsRCxpQkFBS0Usb0JBQUwsQ0FBMEJILE9BQTFCLEVBQW1DSixVQUFuQztBQUNEO0FBQ0Y7QUFaNkI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTs7QUFhOUIsMENBQVdJLE9BQVg7QUFDRDs7QUFFRDs7QUE5QkY7QUFBQTtBQUFBLHdDQWdDdUJJLFNBaEN2QixFQWdDa0M7QUFDOUIsVUFBSUEsVUFBVSxDQUFWLE1BQWlCLEdBQXJCLEVBQTBCLE9BQU9BLFVBQVVDLFNBQVYsQ0FBb0IsQ0FBcEIsQ0FBUDtBQUMxQixhQUFPRCxTQUFQO0FBQ0Q7QUFuQ0g7QUFBQTtBQUFBLHlDQXFDd0JKLE9BckN4QixFQXFDaUNKLFVBckNqQyxFQXFDNkM7QUFDekMsVUFBSUEsV0FBVyxnQkFBWCxNQUFpQ0EsV0FBV00sU0FBWCxHQUF1QkksTUFBdkIsR0FBZ0MsQ0FBckUsRUFBd0U7QUFDdEU7QUFDQSxhQUFLWixlQUFMLENBQXFCYSxNQUFyQixDQUE0QlgsVUFBNUI7QUFDQUksZ0JBQVFILEdBQVIsQ0FBWUQsVUFBWjtBQUNELE9BSkQsTUFJTztBQUNMO0FBQ0FBLG1CQUFXLGdCQUFYO0FBQ0Q7QUFDRjtBQTlDSDs7QUFBQTtBQUFBIiwiZmlsZSI6InBhcnRpYWwta2V5dXAtbWF0Y2hlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIid1c2UgYmFiZWwnXG5cbm1vZHVsZS5leHBvcnRzID1cbmNsYXNzIFBhcnRpYWxLZXl1cE1hdGNoZXIge1xuXG4gIGNvbnN0cnVjdG9yICgpIHtcbiAgICB0aGlzLl9wZW5kaW5nTWF0Y2hlcyA9IG5ldyBTZXQoKVxuICB9XG5cbiAgYWRkUGVuZGluZ01hdGNoIChrZXlCaW5kaW5nKSB7XG4gICAgdGhpcy5fcGVuZGluZ01hdGNoZXMuYWRkKGtleUJpbmRpbmcpXG4gICAga2V5QmluZGluZ1snbmV4dEtleVVwSW5kZXgnXSA9IDBcbiAgfVxuXG4gIC8vIFJldHVybnMgbWF0Y2hpbmcgYmluZGluZ3NzLCBpZiBhbnkuXG4gIC8vIFVwZGF0ZXMgc3RhdGUgZm9yIG5leHQgbWF0Y2guXG4gIGdldE1hdGNoZXMgKHVzZXJLZXl1cEtleXN0cm9rZSkge1xuICAgIHVzZXJLZXl1cEtleXN0cm9rZSA9IHRoaXMuX25vcm1hbGl6ZUtleXN0cm9rZSh1c2VyS2V5dXBLZXlzdHJva2UpXG4gICAgbGV0IG1hdGNoZXMgPSBuZXcgU2V0KClcblxuICAgIC8vIExvb3Agb3ZlciBlYWNoIHBlbmRpbmcga2V5dXAgbWF0Y2guXG4gICAgZm9yIChjb25zdCBrZXlCaW5kaW5nIG9mIHRoaXMuX3BlbmRpbmdNYXRjaGVzKSB7XG4gICAgICBjb25zdCBiaW5kaW5nS2V5c3Ryb2tlVG9NYXRjaCA9IHRoaXMuX25vcm1hbGl6ZUtleXN0cm9rZShcbiAgICAgICAga2V5QmluZGluZy5nZXRLZXl1cHMoKVtrZXlCaW5kaW5nWyduZXh0S2V5VXBJbmRleCddXVxuICAgICAgKVxuICAgICAgaWYgKHVzZXJLZXl1cEtleXN0cm9rZSA9PT0gYmluZGluZ0tleXN0cm9rZVRvTWF0Y2gpIHtcbiAgICAgICAgdGhpcy5fdXBkYXRlU3RhdGVGb3JNYXRjaChtYXRjaGVzLCBrZXlCaW5kaW5nKVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gWy4uLm1hdGNoZXNdXG4gIH1cblxuICAvKiogUHJpdmF0ZSBTZWN0aW9uICoqL1xuXG4gIF9ub3JtYWxpemVLZXlzdHJva2UgKGtleXN0cm9rZSkge1xuICAgIGlmIChrZXlzdHJva2VbMF0gPT09ICdeJykgcmV0dXJuIGtleXN0cm9rZS5zdWJzdHJpbmcoMSlcbiAgICByZXR1cm4ga2V5c3Ryb2tlXG4gIH1cblxuICBfdXBkYXRlU3RhdGVGb3JNYXRjaCAobWF0Y2hlcywga2V5QmluZGluZykge1xuICAgIGlmIChrZXlCaW5kaW5nWyduZXh0S2V5VXBJbmRleCddID09PSBrZXlCaW5kaW5nLmdldEtleXVwcygpLmxlbmd0aCAtIDEpIHtcbiAgICAgIC8vIEZ1bGwgbWF0Y2guIFJlbW92ZSBhbmQgcmV0dXJuIGl0LlxuICAgICAgdGhpcy5fcGVuZGluZ01hdGNoZXMuZGVsZXRlKGtleUJpbmRpbmcpXG4gICAgICBtYXRjaGVzLmFkZChrZXlCaW5kaW5nKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBQYXJ0aWFsIG1hdGNoLiBJbmNyZW1lbnQgd2hhdCB3ZSdyZSBsb29raW5nIGZvciBuZXh0LlxuICAgICAga2V5QmluZGluZ1snbmV4dEtleVVwSW5kZXgnXSsrXG4gICAgfVxuICB9XG5cbn1cbiJdfQ==