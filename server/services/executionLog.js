function createExecutionLogger(tag = "manual-license") {
  const executionLogs = [];
  const push = (type, message) => {
    const normalizedType = ["success", "warning", "error"].includes(type) ? type : "info";
    const text = String(message || "").trim();
    const entry = {
      type: normalizedType,
      message: text,
      timestamp: new Date().toISOString()
    };
    executionLogs.push(entry);
    const prefix = normalizedType === "error" ? `[${tag}][error]` : normalizedType === "warning" ? `[${tag}][warn]` : `[${tag}]`;
    console.log(`${prefix} ${text}`);
    return entry;
  };

  return {
    executionLogs,
    info: (message) => push("info", message),
    success: (message) => push("success", message),
    warning: (message) => push("warning", message),
    error: (message) => push("error", message)
  };
}

function createLogCollector() {
  const logs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const collector = {
    logs,
    startCapture() {
      console.log = (...args) => {
        const message = args.map(arg => {
          if (typeof arg === 'string') return arg;
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }).join(' ');
        logs.push({ message, type: 'info', timestamp: new Date().toISOString() });
        originalLog(...args);
      };
      console.warn = (...args) => {
        const message = args.map(arg => {
          if (typeof arg === 'string') return arg;
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }).join(' ');
        logs.push({ message, type: 'warning', timestamp: new Date().toISOString() });
        originalWarn(...args);
      };
      console.error = (...args) => {
        const message = args.map(arg => {
          if (typeof arg === 'string') return arg;
          try { return JSON.stringify(arg); } catch { return String(arg); }
        }).join(' ');
        logs.push({ message, type: 'error', timestamp: new Date().toISOString() });
        originalError(...args);
      };
    },
    stopCapture() {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  };

  return collector;
}

module.exports = {
  createExecutionLogger,
  createLogCollector
};
