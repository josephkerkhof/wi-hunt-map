{ pkgs, ... }:

{
  packages = [ pkgs.wrangler ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_26;
    npm = {
      enable = true;
      install.enable = true;
    };
  };

  scripts.test-notification = {
    exec = ''exec node "$DEVENV_ROOT/tools/test-notification.mjs"'';
    description = "Send one test notification to a local Field Hours app";
  };

  processes = {
    alerts = {
      exec = ''
        set -e
        node --input-type=module <<'JS'
        import { randomBytes } from 'node:crypto';
        import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
        import { parseEnv } from 'node:util';
        import { generateVAPIDKeys } from 'web-push';

        const path = 'worker/.dev.vars';
        if (!existsSync(path)) {
          const { publicKey, privateKey } = generateVAPIDKeys();
          const vars = 'VAPID_PUBLIC_KEY=' + publicKey + '\n' +
            'VAPID_PRIVATE_KEY=' + privateKey + '\n';
          writeFileSync(path, vars, { flag: 'wx', mode: 0o600 });
        }

        const vars = parseEnv(readFileSync(path, 'utf8'));
        if (!vars.LOCAL_ALERT_TEST_TOKEN) {
          appendFileSync(path, '\nLOCAL_ALERT_TEST_TOKEN=' + randomBytes(32).toString('hex') + '\n');
        }
        JS
        exec env WRANGLER_SEND_METRICS=false wrangler dev --local --config worker/wrangler.jsonc \
          --ip 127.0.0.1 --port 8787 --show-interactive-dev-session false
      '';
      ready = {
        http.get = { port = 8787; path = "/api/alerts/key"; };
        period = 1;
      };
    };
    web = {
      exec = "exec npm run dev -- --strictPort";
      after = [ "devenv:processes:alerts" ];
      ready.http.get = { port = 5173; path = "/"; };
    };
    preview = {
      exec = "npm run build && exec npm run preview -- --port 4173 --strictPort";
      after = [ "devenv:processes:alerts" ];
      ready = {
        http.get = { port = 4173; path = "/api/alerts/key"; };
        period = 1;
      };
    };
  };
}
