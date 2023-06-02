const core = require("@actions/core");
const github = require("@actions/github");
const stringify = require("csv-stringify/lib/sync");
const arraySort = require("array-sort");
const { GitHub } = require("@actions/github/lib/utils");
const { retry } = require("@octokit/plugin-retry");
const { throttling } = require("@octokit/plugin-throttling");

const MyOctokit = GitHub.plugin(throttling, retry);
const eventPayload = require(process.env.GITHUB_EVENT_PATH);

const token = core.getInput("token", { required: true });
const org =
  core.getInput("org", { required: false }) || eventPayload.organization.login;
const repoName =
  core.getInput("repoName", { required: true }) || eventPayload.repository.name;

let fileDate;


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

// return a list of repo names that are associated with the template repo (which is the repoName input)
  (async () => {
    try {
      let paginationMember = null;
      let templateRepoArray = [];

      const query = `
      query ($owner: String!, $cursorID: String) {
        organization(login: $owner) {
          repositories(first: 100, after: $cursorID) {
            nodes {
              name
              templateRepository {
                nameWithOwner
              }
            }
            pageInfo {
              hasNextPage
              endCursor
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
          owner: org,
          cursorID: paginationMember,
        });

        console.log(dataJSON.organization.repositories.pageInfo.hasNextPage);

        const repos = dataJSON.organization.repositories.nodes;

        hasNextPageMember =
          dataJSON.organization.repositories.pageInfo.hasNextPage;

        if (hasNextPageMember) {
          paginationMember =
            dataJSON.organization.repositories.pageInfo.endCursor;
        } else {
          paginationMember = null;
        }

        templateRepoArray = templateRepoArray.concat(repos);
      } while (hasNextPageMember);

      const filteredArray = templateRepoArray.filter(
        (x) => x.templateRepository !== null
      );
      const filteredArray2 = filteredArray.filter(
        (x) => x.templateRepository.nameWithOwner === repoName
      );
      const repoNames = filteredArray2.map((x) => x.name);

      await repoDirector(repoNames);
    } catch (error) {
      core.setFailed(error.message);
    }
  })();

async function repoDirector(repoArray) {
  try {
    let csvArray = [];
    const filteredArray = repoArray.filter((x) => x);

    filteredArray.forEach((element) => {
      console.log(element);
      const repoName = element;

      csvArray.push({
        repoName,
      });
    });

    sortTotals(csvArray);
  } catch (error) {
    core.setFailed(error.message);
  }
}

// Add columns, sort and push report to repo
async function sortTotals(csvArray) {
  try {
    const columns = {
      repoName: "Repo name",
    };

    const sortColumn =
      core.getInput("sort", { required: false }) || "additions";
    const sortArray = arraySort(csvArray, sortColumn, { reverse: true });
    sortArray.unshift(columns);

    // Convert array to csv
    const csv = stringify(sortArray, {});

    // Prepare path/filename, repo/org context and commit name/email variables
    const reportPath = `reports/${org}-${
      new Date().toISOString().substring(0, 19) + "Z"
    }-${fileDate}.csv`;
    const committerName =
      core.getInput("committer-name", { required: false }) || "github-actions";
    const committerEmail =
      core.getInput("committer-email", { required: false }) ||
      "github-actions@github.com";
    const { owner, repo } = github.context.repo;

    // Push csv to repo
    const opts = {
      owner,
      repo,
      path: reportPath,
      message: `${new Date().toISOString().slice(0, 10)} Git audit-log report`,
      content: Buffer.from(csv).toString("base64"),
      committer: {
        name: committerName,
        email: committerEmail,
      },
    };

    console.log(opts);
    console.log(`Pushing final CSV report to repository path: ${reportPath}`);

    await octokit.rest.repos.createOrUpdateFileContents(opts);
  } catch (error) {
    core.setFailed(error.message);
  }
}
