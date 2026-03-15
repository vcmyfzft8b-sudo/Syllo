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

  return (
    <main className="space-y-6">
      <section className="ios-card app-hero">
        <div className="ios-title-block">
          <p className="ios-section-label">{article.category}</p>
          <h1 className="ios-large-title">{article.title}</h1>
          <p className="ios-subtitle">
            A short guide for the task you want to complete, without extra steps.
          </p>
        </div>
      </section>

      <section className="ios-card">
        <div className="markdown">
          <MarkdownRenderer content={article.content} />
        </div>
      </section>
    </main>
  );
}
