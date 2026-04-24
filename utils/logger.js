let logs = [];
let lastRunTime = null;

const addLog = (message) => {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${message}`;
  logs.push(entry);
  console.log(entry);
  if (logs.length > 1000) logs.shift();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getLogs = () => logs;
const clearLogs = () => { logs = []; };
const setLastRunTime = (time) => { lastRunTime = time; };
const getLastRunTime = () => lastRunTime;

module.exports = { addLog, sleep, getLogs, clearLogs, setLastRunTime, getLastRunTime };
