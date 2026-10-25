
            var crawler = new exportFn({ serverTime: Date.now(), _2827c887a48a351a: false });
            if (crawler && crawler.init) crawler.init();
            function getAntiContent() {
                if (!crawler || typeof crawler.messagePack !== 'function') return '';
                return crawler.messagePack();
            }
            