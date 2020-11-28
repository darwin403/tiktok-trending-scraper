const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const dayjs = require("dayjs");

const logger = require("./utils/logger");
const csvWriter = createCsvWriter({
  path: path.join(__dirname, "trending.csv"),
  header: [
    { id: "createTime", title: "Date" },
    { id: "playCount", title: "Views" },
    { id: "diggCount", title: "Likes" },
    { id: "url", title: "URL" },
    { id: "author", title: "Author" },
    { id: "commentCount", title: "Comments" },
    { id: "shareCount", title: "Shares" },
    { id: "desc", title: "Description" },
    { id: "id", title: "ID" },
  ],
});

/***********
 * OPTIONS *
 ***********/
const options = {
  maxResults: 1000, // max results
  optimizeLoad: true, // block images, fonts, stylesheets
  proxy: {
    enabled: false, // enable http proxy
    server: "user:pass@zproxy.lum-superproxy.io:22225",
  },
  autoLogin: {
    enabled: false, // enable automated login
    credentials: {
      username: "skdcodes@gmail.com",
      password: "dh12jdj2",
    },
  },
};

/*********
 * START *
 *********/
(async () => {
  const [proxy_credentials, proxy_server] = options.proxy.server.split("@");
  const [proxy_username, proxy_password] = proxy_credentials.split(":");

  // Puppeteer arguments
  const puppeteerArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-infobars",
    "--window-position=0,0",
    "--ignore-certifcate-errors",
    "--ignore-certifcate-errors-spki-list",
  ];

  if (options.proxy.enabled)
    puppeteerArgs.push(`--proxy-server=${proxy_server}`);

  // Puppeteer stealth
  puppeteer.use(StealthPlugin());

  // Puppeteer launch
  puppeteer
    .launch({
      headless: false,
      args: puppeteerArgs,
    })
    .then(async (browser) => {
      const page = (await browser.pages())[0];

      // Options status
      const useProxy = options.proxy.enabled && options.proxy.server;
      const useAutologin =
        options.autoLogin.enabled &&
        options.autoLogin.credentials.username &&
        options.autoLogin.credentials.password;

      // Authenticate proxy
      if (useProxy) {
        logger.info(`Using Proxy (SERVER): ${options.proxy.server}`);

        await page.authenticate({
          username: proxy_username,
          password: proxy_password,
        });
      }

      await page.setRequestInterception(true);

      // Optimize loading speed
      page.on("request", (request) => {
        const isAssets = ["image", "stylesheet", "font"].includes(
          request.resourceType()
        );
        const isSubscribe = ["batch/", "/v1/list"].some((i) =>
          request.url().includes(i)
        );
        const isPng = request.url().endsWith(".png");
        const isCaptcha = request.url().includes("security-captcha");

        // Block requests
        if (
          options.optimizeLoad &&
          (isAssets || isSubscribe || isPng) &&
          !isCaptcha
        ) {
          return request.abort();
        }

        request.continue();
      });

      logger.info("Load Login Page (WAITING)");

      // Login load
      try {
        page.goto("https://www.tiktok.com/login/phone-or-email/email?lang=en");
        await page.waitForNavigation({ waitUntil: "networkidle2" });

        logger.info("Load Login Page (SUCCESS)");
      } catch (err) {
        logger.error(`Load Login Page (FAILED): ${err}`);
        return await browser.close();
      }

      // Login enter credentials
      if (useAutologin) {
        const { username, password } = options.autoLogin.credentials;

        logger.info(`Using Autologin (CREDENTIALS): ${username}:${password}`);

        try {
          await page.type("input[name='email']", username);
          await page.type("input[name='password']", password);
          await page.click('button[type="submit"]:not([disabled])');

          logger.info("Autologin Entered (SUCCESS)");
        } catch (err) {
          logger.error(`Autologin Entered (FAILED): ${err}`);
          return await browser.close();
        }
      }

      logger.info("Gathering Trending Videos (WAITING)");

      let resultsCount = 0;

      // Gather trending videos
      page.on("response", async (response) => {
        if (
          response.url().includes("/api/item_list") &&
          response.status() === 200
        ) {
          try {
            const results = await response.json();

            // csv rows
            const rows = results.items.map((r) => {
              return {
                id: r.id,
                author: r.author.uniqueId,
                url: `https://www.tiktok.com/@${r.author.uniqueId}/video/${r.id}`,
                desc: r.desc,
                diggCount: r.stats.diggCount,
                shareCount: r.stats.shareCount,
                commentCount: r.stats.commentCount,
                playCount: r.stats.playCount,
                createTime: dayjs.unix(r.createTime).format("YYYY/MM/DD HH:mm"),
              };
            });

            // csv write
            csvWriter.writeRecords(rows);

            // update row count
            resultsCount += rows.length;

            logger.info(
              `Gathering Trending Videos (GATHERED): ${resultsCount}`
            );

            // scroll for next results
            if (resultsCount < options.maxResults) {
              await page.waitForFunction(
                (resultsCount) =>
                  document.querySelectorAll("span.lazyload-wrapper").length >=
                  resultsCount,
                {},
                resultsCount
              );
              await page.evaluate(() =>
                window.scrollTo(0, document.body.scrollHeight)
              );
            } else {
              logger.info(`Gathering Trending Videos (DONE)`);
              await browser.close();
            }
          } catch (err) {
            logger.warn(`Gathering Trending Videos (ERROR): ${err}`);
          }
        }
      });
    })

    .catch(console.error);
})();
