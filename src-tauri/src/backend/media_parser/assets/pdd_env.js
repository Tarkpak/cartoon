
            var window = this;
            var self = this;
            var setTimeout = function(fn) {};
            var clearTimeout = function() {};
            var history = { back: function(){}, forward: function(){}, go: function(){}, length: 1 };
            function Element() {}
            function HTMLElement() {}
            function HTMLCanvasElement() {}
            function HTMLImageElement() {}
            var document = {
              referrer: 'https://mobile.yangkeduo.com/',
              documentElement: { clientWidth: 375, clientHeight: 667 },
              body: { clientWidth: 375, clientHeight: 667 },
              createElement: function() { return { getContext: function() { return null; } }; },
              getElementsByTagName: function() { return []; },
              addEventListener: function() {},
              removeEventListener: function() {}
            };
            var location = {
              href: 'https://mobile.yangkeduo.com/fyxmkief.html',
              origin: 'https://mobile.yangkeduo.com',
              protocol: 'https:',
              host: 'mobile.yangkeduo.com',
              hostname: 'mobile.yangkeduo.com',
              pathname: '/fyxmkief.html',
              search: '',
              hash: ''
            };
            var navigator = {
              userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1',
              appVersion: '5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1',
              platform: 'iPhone',
              language: 'zh-CN',
              languages: ['zh-CN', 'zh'],
              cookie: ''
            };
            var screen = { width: 375, height: 667, availWidth: 375, availHeight: 667, colorDepth: 24 };

            var exportFn;
            var __LOADABLE_LOADED_CHUNKS__ = {
              push: function(arr) {
                var mods = arr[1];
                if (mods && mods[53636]) {
                  var moduleObj = { exports: {} };
                  mods[53636](moduleObj);
                  exportFn = moduleObj.exports;
                }
              }
            };
            