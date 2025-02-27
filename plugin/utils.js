function delay(ms) {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
    } else {
      setTimeout(resolve, ms)
    }
  });
}

module.exports = { delay };
