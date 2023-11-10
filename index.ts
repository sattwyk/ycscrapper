import { Browser, Page, webkit } from 'playwright';
import fs from 'fs';

interface Company {
  name: string;
  location: string;
  link: string;
  founders: Founder[];
}

interface Founder {
  name: string;
  links: string[];
}

const YC_BATCH = 'W23';

async function main() {
  let browser;

  try {
    console.log('---- Launching Browser ----');
    browser = await webkit.launch();
    console.log('---- Browser Launched ----');

    const page = await browser.newPage();
    console.log('---- New Page Created ----');

    const url = `https://www.ycombinator.com/companies?batch=${YC_BATCH}&regions=America%20%2F%20Canada&regions=Oceania&regions=United%20Kingdom&team_size=["1","25"]`;

    await page.goto(url);
    console.log('---- Navigated to the Y Combinator Companies Page ----');

    const companyList = new Set<Company>();

    for await (const company of getCompanies(page)) {
      const { name, location, link } = company;

      const existingCompany = Array.from(companyList).find(
        (c) => c.name === name && c.location === location && c.link === link
      );

      if (!existingCompany) {
        console.log(`Adding new company: ${name}`);
        // Adding an empty founders array
        companyList.add({ ...company, founders: [] });
      }
    }

    console.log('---- Retrieving Founders Data ----');

    const stream = fs.createWriteStream(`company_data_YC_${YC_BATCH}.json`);

    stream.write('[\n');

    for (const company of companyList) {
      const founderData = await getFoundersDataWithRetries(
        browser,
        company.link
      );

      if (founderData) {
        company.founders = founderData;
        stream.write(JSON.stringify(company) + ',\n');
      }
    }

    stream.write(']');
    // Write the company data to a CSV file
    stream.end();

    console.log('---- Data Collection Complete, Closing Browser ----');
  } catch (error: unknown) {
    //@ts-ignore
    console.error(`An error occurred: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
      console.log('---- Browser Closed ----');
    }
  }
}

async function* getCompanies(
  page: Page
): AsyncGenerator<
  { name: string; location: string; link: string },
  void,
  unknown
> {
  let previousHeight;
  let currentHeight = 0;

  do {
    previousHeight = currentHeight;

    // Wait for some time for the content to load
    await page.waitForSelector('._company_lx3q7_339');

    const companies = await page.$$('._company_lx3q7_339');
    console.log('---- Companies Found ----');

    for (const companyElement of companies) {
      const companyNameElement = await companyElement.$('._coName_lx3q7_454');
      const companyLocationElement = await companyElement.$(
        '._coLocation_lx3q7_470'
      );

      const name = await companyNameElement?.innerText();
      const location = await companyLocationElement?.innerText();
      const route = await companyElement.getAttribute('href');
      const link = `https://ycombinator.com${route}`;

      if (name && location && link) {
        console.log(
          `Found company: ${name}, Location: ${location}, Link: ${link}`
        );
        yield { name, location, link };
      }
    }

    // Scroll to the bottom of the page
    currentHeight = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });
  } while (currentHeight > previousHeight);
}

async function getFoundersDataWithRetries(
  browser: Browser,
  companyLink: string,
  maxRetries: number = 3
): Promise<Founder[] | null> {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      console.log(`---- Opening Company Link: ${companyLink} ----`);
      const newPage = await browser.newPage();

      await newPage.goto(companyLink);
      console.log(`---- Navigated to Company Link: ${companyLink} ----`);

      await newPage.waitForSelector('.ycdc-card', { timeout: 10000 }); // Adjust the timeout value as needed
      console.log(`---- Company Page Loaded: ${companyLink} ----`);

      const founders = await newPage.$$('.ycdc-card');
      console.log(`---- Found ${founders.length} Founders ----`);

      const founderList: Founder[] = [];

      for (const founderElement of founders) {
        const nameElement = await founderElement.$('.font-bold');
        const founderName = await nameElement?.textContent();
        const links: string[] = [];

        const socials = await founderElement.$('.space-x-2');
        const linkElements = await socials?.$$('a');

        if (linkElements && founderName) {
          for (const linkElement of linkElements) {
            const href = await linkElement.getAttribute('href');
            if (href) {
              links.push(href);
            }
          }
          founderList.push({ name: founderName, links });
        }
      }

      await newPage.close();
      console.log(`---- Closed Company Page: ${companyLink} ----`);

      return founderList.length > 0 ? founderList : null;
    } catch (error: unknown) {
      // @ts-ignore
      console.error(`Error processing ${companyLink}: ${error.message}`);
      retries++;
      console.log(`Retrying... (Attempt ${retries}/${maxRetries})`);
    }
  }

  console.error(
    `Failed to retrieve data for ${companyLink} after ${maxRetries} attempts.`
  );
  return null;
}

main();
