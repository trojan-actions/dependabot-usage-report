const core = require("@actions/core");
const github = require("@actions/github");
const stringify = require("csv-stringify/lib/sync");
const arraySort = require("array-sort");
const { GitHub } = require("@actions/github/lib/utils");
const { retry } = require("@octokit/plugin-retry");
const { throttling } = require("@octokit/plugin-throttling");

const MyOctokit = GitHub.plugin(throttling, retry);

const token = core.getInput("token", { required: true });
const org = core.getInput("org", { required: false });
const fileDate = new Date().toISOString().substring(0, 19) + "Z";

// API throttling and retry
const octokit = new MyOctokit({
  auth: token,
  request: {
    retries: 3,
    retryAfter: 180,
  },
  throttle: {
    onRateLimit: (retryAfter, options, octokit) => {
      octokit.log.warn(
        `Request quota exhausted for request ${options.method} ${options.url}`
      );

      if (options.request.retryCount === 0) {
        // only retries once
        octokit.log.info(`Retrying after ${retryAfter} seconds!`);
        return true;
      }
    },
    onAbuseLimit: (retryAfter, options, octokit) => {
      // does not retry, only logs a warning
      octokit.log.warn(
        `Abuse detected for request ${options.method} ${options.url}`
      );
    },
  },
});

// Function to fetch repositories with Dependabot.yml files
async function getDependabotRepos() {
  try {
    let paginationMember = null;
    let dependabotRepos = [];

    const query = `
      query ($org: String!, $cursor: String) {
        organization(login: $org) {
          repositories(first: 10, after: $cursor) {
            nodes {
              name
              object(expression: "main:.github/dependabot.yml") {
                ... on Blob {
                  text
                }
              }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `;

    let hasNextPageMember = false;
    let dataJSON = null;

    do {
      dataJSON = await octokit.graphql({
        query,
        org,
        cursor: paginationMember,
      });

      const repos = dataJSON.organization.repositories.nodes;

      hasNextPageMember =
        dataJSON.organization.repositories.pageInfo.hasNextPage;

      if (hasNextPageMember) {
        paginationMember =
          dataJSON.organization.repositories.pageInfo.endCursor;
      } else {
        paginationMember = null;
      }

      dependabotRepos = dependabotRepos.concat(repos);
    } while (hasNextPageMember);

    return dependabotRepos;
  } catch (error) {
    throw new Error(`Error fetching dependabot repos: ${error.message}`);
  }
}

// Function to create a report
async function createReport(repos) {
  try {
    const csvArray = repos.map((repo) => {
      return {
        repoName: repo.name,
        hasDependabot: repo.object ? "Yes" : "No",
      };
    });

    const sortedCsvArray = arraySort(csvArray, "repoName");
    sortedCsvArray.unshift({
      repoName: "Repository",
      hasDependabot: "Dependabot.yml",
    });

    // Convert array to CSV
    const csv = stringify(sortedCsvArray, {});

    // Prepare path/filename, repo/org context, and commit name/email variables
    const reportPath = `reports/${org}-${fileDate}-dependabot-report.csv`;
    const committerName =
      core.getInput("committer-name", { required: false }) || "github-actions";
    const committerEmail =
      core.getInput("committer-email", { required: false }) ||
      "github-actions@github.com";
    const { owner, repo } = github.context.repo;

    // Push CSV to the repo
    const opts = {
      owner,
      repo,
      path: reportPath,
      message: `${new Date().toISOString().slice(0, 10)} Dependabot Report`,
      content: Buffer.from(csv).toString("base64"),
      committer: {
        name: committerName,
        email: committerEmail,
      },
    };

    await octokit.rest.repos.createOrUpdateFileContents(opts);
  } catch (error) {
    throw new Error(`Error creating report: ${error.message}`);
  }
}

// Main function
(async () => {
  try {
    const dependabotRepos = await getDependabotRepos();
    await createReport(dependabotRepos);
  } catch (error) {
    core.setFailed(error.message);
  }
})();
