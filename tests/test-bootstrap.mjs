import os from "node:os";

// tsx reads os.userInfo() to name its temporary directory; some managed Windows
// runners block that OS call, so give this test process a harmless local name.
if (!process.geteuid) {
  Object.defineProperty(os, "userInfo", {
    configurable: true,
    value: () => ({
      username: "bahaban-tests",
      uid: 0,
      gid: 0,
      shell: null,
      homedir: os.tmpdir(),
    }),
  });
}
