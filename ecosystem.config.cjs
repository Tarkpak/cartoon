module.exports = {
  apps: [
    {
      name: "manju",
      script: "server/index.mjs",
      env: {
        PORT: 4000,
        NODE_ENV: "production",
      },
    },
  ],
};
