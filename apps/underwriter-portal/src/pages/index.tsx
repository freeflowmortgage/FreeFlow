import React from 'react';
import Head from 'next/head';
import UnderwriterSplitViewDemoV7 from '../components/UnderwriterSplitViewDemo-v7';

export default function Home() {
  return (
    <>
      <Head>
        <title>FreeFlow Underwriter Portal</title>
        <meta name="description" content="FreeFlow AI B2B Income Underwriting Suite" />
      </Head>
      <main className="min-h-screen bg-slate-900 text-slate-100">
        <UnderwriterSplitViewDemoV7 />
      </main>
    </>
  );
}
