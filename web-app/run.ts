const greet = (name: string): string => {
  return `Hello, ${name}!`;
};

async function agentsSync() {
  const response = await fetch("http://localhost:3000/api/sync/agents", {
    method: "POST",
    headers: {
      "admin-api-key": "bWneFe0qBoURBJcEuW5vFFbQBIjnFEor",
    },
  });
  return response.status;
}

async function jobsSync() {
  const response = await fetch("http://localhost:3000/api/sync/jobs", {
    method: "POST",
    headers: {
      "admin-api-key": "bWneFe0qBoURBJcEuW5vFFbQBIjnFEor",
    },
  });
  return response.status;
}

async function run() {
  const [agents, jobs] = await Promise.all([agentsSync(), jobsSync()]);
  console.log(agents, jobs);
}

run();
