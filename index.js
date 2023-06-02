const core = require("@actions/core");
const { GitHub } = require("@actions/github/lib/utils");
const { retry } = require("@octokit/plugin-retry");
const { throttling } = require("@octokit/plugin-throttling");

const MyOctokit = GitHub.plugin(throttling, retry);
const eventPayload = require(process.env.GITHUB_EVENT_PATH);

const token = core.getInput("token", { required: true });
const org =
  core.getInput("org", { required: false }) || eventPayload.organization.login;
const repoName =
core.getInput("repoName", { required: true }) ||
  eventPayload.repository.name;

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
async function getTemplateRepos() {
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

    return repoNames;
  } catch (error) {
    core.setFailed(error.message);
  }
}

// add the repo names to a JSON file in the repo
async function addRepoNames(repoNames) {
  try {
    const repo = eventPayload.repository.name;
    const owner = eventPayload.repository.owner.login;
    const path = "repos/" + owner + "/" + repo + "/contents/repoNames.json";
    const message = "Adding repo names to the JSON file";
    const content = Buffer.from(JSON.stringify(repoNames)).toString("base64");
    const branch = eventPayload.repository.default_branch;
    const sha = eventPayload.repository.head_commit.id;

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content,
      branch,
      sha,
    });
  } catch (error) {
    core.setFailed(error.message);
  }
}

// Usage of the functions
async function run() {
  try {
    const repoNames = await getTemplateRepos();
    await addRepoNames(repoNames);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
