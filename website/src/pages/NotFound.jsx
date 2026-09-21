import React from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Wordmark } from '../components/Brand.jsx';
import { Button } from '../components/ui.jsx';

export default function NotFound() {
  return <section className="mx-auto grid min-h-[80dvh] max-w-page place-items-center px-5 pt-28 text-center md:px-8">
    <div>
      <p className="font-term text-[14px] text-brand-red">Process exited with code 404</p>
      <Wordmark auto className="mx-auto mt-6 h-auto w-[min(420px,80vw)] opacity-80"/>
      <h1 className="display mt-8 text-[clamp(1.8rem,4vw,2.8rem)]">This page is not running.</h1>
      <p className="lede mx-auto mt-3 text-[16px]">The address may be mistyped, or the page moved.</p>
      <div className="mt-8 flex justify-center"><Button to="/" variant="glass"><ArrowLeft size={16}/>Back to the home page</Button></div>
    </div>
  </section>;
}
