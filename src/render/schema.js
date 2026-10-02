// Structured data that mirrors visible page content. No FAQPage, no invented people.

export function absoluteUrl(siteUrl, pathOrUrl) {
  if (!pathOrUrl) return '';
  return new URL(pathOrUrl, siteUrl + '/').toString();
}

export function articleUrl(siteUrl, slug) {
  return `${siteUrl}/articles/${slug}/`;
}

export function organizationNode(site) {
  const org = { '@type': 'Organization', '@id': `${site.siteUrl}/#organization`, name: site.organizationName, url: `${site.siteUrl}/` };
  if (site.logoUrl) org.logo = { '@type': 'ImageObject', url: absoluteUrl(site.siteUrl, site.logoUrl) };
  if (site.sameAs?.length) org.sameAs = site.sameAs;
  return org;
}

export function breadcrumbNode(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

export function buildArticleSchema(article, site) {
  const url = article.canonicalUrl || articleUrl(site.siteUrl, article.slug);
  const node = {
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: article.title.slice(0, 110),
    description: article.metaDescription,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    inLanguage: site.locale || 'en',
    datePublished: article.publishedAt,
    dateModified: article.updatedAt || article.publishedAt,
    author: { '@id': `${site.siteUrl}/#organization` },
    publisher: { '@id': `${site.siteUrl}/#organization` },
    wordCount: article.wordCount,
  };
  if (article.featuredImage) node.image = [absoluteUrl(site.siteUrl, article.featuredImage)];
  if (article.primaryTopic) node.articleSection = article.primaryTopic;
  if (article.secondaryTopics?.length) node.keywords = article.secondaryTopics.join(', ');
  const citations = (article.sources || []).map((s) => s.url).filter(Boolean);
  if (citations.length) node.citation = citations;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      node,
      breadcrumbNode([
        { name: 'Home', url: `${site.siteUrl}/` },
        { name: 'Articles', url: `${site.siteUrl}/articles/` },
        { name: article.title, url },
      ]),
      organizationNode(site),
    ],
  };
}

export function buildIndexSchema(site, url, pageTitle) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${url}#page`, url, name: pageTitle, description: site.articlesIndexDescription, isPartOf: { '@id': `${site.siteUrl}/#organization` } },
      breadcrumbNode([{ name: 'Home', url: `${site.siteUrl}/` }, { name: 'Articles', url: `${site.siteUrl}/articles/` }]),
      organizationNode(site),
    ],
  };
}

/** Safe JSON-LD serialisation for embedding in <script>. */
export function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
