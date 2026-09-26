
    window.WEBHOME_PAGE_OPENED_AT = Date.now();
    if (window.fongmiBridge) document.documentElement.classList.add("fm-native");
    (function () {
      var search = String(window.location && window.location.search || "");
      var preview = false;
      var diagnostic = false;
      try {
        var params = new URLSearchParams(search);
        preview = params.get("_tv") === "1";
        diagnostic = params.get("_tv_diag") === "1";
      } catch (e) {
        preview = /(?:^|[?&])_tv=1(?:&|$)/.test(search);
        diagnostic = /(?:^|[?&])_tv_diag=1(?:&|$)/.test(search);
      }
      if (preview) window.WEBHOME_TV_PREVIEW_REQUESTED = true;
      if (diagnostic) document.documentElement.classList.add("tv-diagnostic-enabled");
    })();
    (function () {
      var protoList = [
        window.Element && Element.prototype,
        window.Document && Document.prototype,
        window.DocumentFragment && DocumentFragment.prototype
      ];
      for (var p = 0; p < protoList.length; p++) {
        var proto = protoList[p];
        if (!proto) continue;
        if (proto.replaceChildren) continue;
        proto.replaceChildren = function () {
          while (this.firstChild) this.removeChild(this.firstChild);
          for (var i = 0; i < arguments.length; i++) {
            var child = arguments[i];
            this.appendChild(child && child.nodeType ? child : document.createTextNode(String(child)));
          }
        };
      }
      if (window.Element && !Element.prototype.matches) {
        Element.prototype.matches = Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
      }
      if (window.Element && !Element.prototype.closest) {
        Element.prototype.closest = function (selector) {
          var el = this;
          while (el && el.nodeType === 1) {
            if (el.matches && el.matches(selector)) return el;
            el = el.parentElement || el.parentNode;
          }
          return null;
        };
      }
      if (!Object.values) {
        Object.values = function (obj) {
          return Object.keys(obj || {}).map(function (key) { return obj[key]; });
        };
      }
      if (!Object.entries) {
        Object.entries = function (obj) {
          return Object.keys(obj || {}).map(function (key) { return [key, obj[key]]; });
        };
      }
      if (!Array.from) {
        Array.from = function (value, mapFn, thisArg) {
          var result = [];
          if (value == null) return result;
          var iterator = typeof Symbol !== "undefined" && value[Symbol.iterator];
          var i = 0;
          if (typeof iterator === "function") {
            var step;
            var iter = iterator.call(value);
            while (!(step = iter.next()).done) {
              result.push(mapFn ? mapFn.call(thisArg, step.value, i++) : step.value);
            }
            return result;
          }
          var length = Number(value.length) || 0;
          for (; i < length; i++) {
            result.push(mapFn ? mapFn.call(thisArg, value[i], i) : value[i]);
          }
          return result;
        };
      }
      if (window.NodeList && !NodeList.prototype.forEach) {
        NodeList.prototype.forEach = Array.prototype.forEach;
      }
      if (window.HTMLCollection && !HTMLCollection.prototype.forEach) {
        HTMLCollection.prototype.forEach = Array.prototype.forEach;
      }
      if (!Array.prototype.includes) {
        Array.prototype.includes = function (value, fromIndex) {
          return this.indexOf(value, fromIndex || 0) !== -1;
        };
      }
      if (!Array.prototype.flat) {
        Array.prototype.flat = function (depth) {
          var maxDepth = depth == null ? 1 : Number(depth) || 0;
          var flatten = function (items, level) {
            var acc = [];
            for (var i = 0; i < items.length; i++) {
              var item = items[i];
              if (Array.isArray(item) && level < maxDepth) {
                var nested = flatten(item, level + 1);
                for (var n = 0; n < nested.length; n++) acc.push(nested[n]);
              } else {
                acc.push(item);
              }
            }
            return acc;
          };
          return flatten(this, 0);
        };
      }
      if (!Array.prototype.flatMap) {
        Array.prototype.flatMap = function (callback, thisArg) {
          return this.map(callback, thisArg).flat();
        };
      }
      if (!String.prototype.includes) {
        String.prototype.includes = function (search, start) {
          return this.indexOf(search, start || 0) !== -1;
        };
      }
      if (!String.prototype.startsWith) {
        String.prototype.startsWith = function (search, start) {
          return this.substr(start || 0, search.length) === search;
        };
      }
      if (!String.prototype.endsWith) {
        String.prototype.endsWith = function (search, length) {
          var value = String(this);
          var end = length == null ? value.length : Math.min(Number(length) || 0, value.length);
          return value.substring(end - search.length, end) === search;
        };
      }
      if (window.Promise && !Promise.prototype.finally) {
        Promise.prototype.finally = function (callback) {
          var P = this.constructor;
          return this.then(function (value) {
            return P.resolve(callback()).then(function () { return value; });
          }, function (reason) {
            return P.resolve(callback()).then(function () { throw reason; });
          });
        };
      }
      var detectLayoutGap = function () {
        if (!document || !document.body || !document.documentElement) return;
        var root = document.documentElement;
        var flex = document.createElement("div");
        var grid = document.createElement("div");
        var makeChild = function () {
          var child = document.createElement("div");
          child.style.height = "1px";
          child.style.width = "1px";
          return child;
        };
        try {
          flex.style.cssText = "position:absolute;left:-9999px;top:-9999px;display:flex;flex-direction:column;gap:1px;visibility:hidden;";
          flex.appendChild(makeChild());
          flex.appendChild(makeChild());
          grid.style.cssText = "position:absolute;left:-9999px;top:-9999px;display:grid;grid-template-columns:1px;gap:1px;visibility:hidden;";
          grid.appendChild(makeChild());
          grid.appendChild(makeChild());
          document.body.appendChild(flex);
          document.body.appendChild(grid);
          if (flex.scrollHeight < 3 || grid.scrollHeight < 3) root.classList.add("no-layout-gap");
        } catch (e) {
          root.classList.add("no-layout-gap");
        }
        try {
          if (flex.parentNode) flex.parentNode.removeChild(flex);
          if (grid.parentNode) grid.parentNode.removeChild(grid);
        } catch (e) {}
      };
      var detectCssFunctions = function () {
        if (!document || !document.documentElement || !window.CSS || !CSS.supports) {
          document.documentElement.classList.add("no-css-functions");
          return;
        }
        try {
          if (!CSS.supports("width", "min(10px, 20px)") || !CSS.supports("width", "clamp(10px, 2vw, 20px)")) {
            document.documentElement.classList.add("no-css-functions");
          }
        } catch (e) {
          document.documentElement.classList.add("no-css-functions");
        }
      };
      var detectAspectRatio = function () {
        if (!document || !document.documentElement) return;
        var root = document.documentElement;
        if (!window.CSS || !CSS.supports) {
          root.classList.add("no-aspect-ratio");
          return;
        }
        try {
          if (!CSS.supports("aspect-ratio", "2 / 3")) {
            root.classList.add("no-aspect-ratio");
            return;
          }
        } catch (e) {
          root.classList.add("no-aspect-ratio");
          return;
        }
        var measure = function () {
          if (!document.body) return;
          var box = document.createElement("div");
          try {
            box.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:20px;aspect-ratio:2/1;visibility:hidden;";
            document.body.appendChild(box);
            var height = box.getBoundingClientRect ? box.getBoundingClientRect().height : box.offsetHeight;
            if (height < 8 || height > 12) root.classList.add("no-aspect-ratio");
          } catch (e) {
            root.classList.add("no-aspect-ratio");
          }
          try { if (box.parentNode) box.parentNode.removeChild(box); } catch (e) {}
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", measure);
        else measure();
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", detectLayoutGap);
      else detectLayoutGap();
      detectCssFunctions();
      detectAspectRatio();
    })();
  