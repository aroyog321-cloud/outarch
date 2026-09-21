import React from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';

// The page's fixed backdrop: a faint grid under the top of the page and three
// soft light sources in the brand colours that drift at different speeds as
// the page scrolls, so the surface has depth without competing with content.
export default function Backdrop() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const blueY = useTransform(scrollYProgress, [0, 1], ['0vh', reduce ? '0vh' : '-30vh']);
  const mintY = useTransform(scrollYProgress, [0, 1], ['0vh', reduce ? '0vh' : '40vh']);
  const violetY = useTransform(scrollYProgress, [0, 1], ['0vh', reduce ? '0vh' : '-55vh']);
  return <div className="backdrop" aria-hidden="true">
    <div className="backdrop__grid"/>
    <motion.div className="backdrop__orb backdrop__orb--blue" style={{ y: blueY }}/>
    <motion.div className="backdrop__orb backdrop__orb--mint" style={{ y: mintY }}/>
    <motion.div className="backdrop__orb backdrop__orb--violet" style={{ y: violetY }}/>
  </div>;
}
