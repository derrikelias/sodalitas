const deployment = require("./src/_data/deployment.json");

module.exports = function (eleventyConfig) {
  // Static assets copied through untouched.
  eleventyConfig.addPassthroughCopy("src/assets");

  // Members collection — every file in src/members/, sorted by member
  // number rather than filename or date, since that's the ordering
  // that actually matters here.
  eleventyConfig.addCollection("members", function (collectionApi) {
    return collectionApi
      .getFilteredByGlob("src/members/*.md")
      .sort((a, b) => Number(a.data.number) - Number(b.data.number));
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    // Derived from src/_data/deployment.json rather than hardcoded, so
    // going live on sodalitas.cc — and falling back from it — both
    // rebuild with the correct paths automatically. See README.
    pathPrefix: deployment.customDomainActive ? "" : "/sodalitas/",
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};

