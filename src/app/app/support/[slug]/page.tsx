import { notFound } from "next/navigation";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { getHelpArticle } from "@/lib/help-center";

export default async function SupportArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getHelpArticle(slug);

  if (!article) {
    notFound();
  }

  const content = article.content.replace(/^# .+\n+/, "");

  return (
    <main className="home-dashboard pb-8">
      <section className="dashboard-section">
        <div>
          <p className="dashboard-overline">{article.category}</p>
          <h1 className="dashboard-page-title">{article.title}</h1>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-surface-card help-article-card">
          <div className="markdown">
            <MarkdownRenderer content={content} />
          </div>
        </div>
      </section>
    </main>
  );
}
