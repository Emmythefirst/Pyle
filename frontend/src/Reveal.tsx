import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";

/**
 * Scroll-triggered entrance, matching the original design's IntersectionObserver
 * behavior (threshold 0.12, translateY(28px) -> none, 0.9s cubic-bezier) --
 * dropped during the initial port for time, restored per user request.
 * Polymorphic (`as`) since the original applied this to section/div wrappers
 * of different kinds, not a single fixed element type.
 */
export function Reveal({
  as: Tag = "div",
  delay = 0,
  style,
  children,
  ...rest
}: {
  as?: ElementType;
  delay?: number;
  style?: CSSProperties;
  children: ReactNode;
  [key: string]: unknown;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const revealStyle: CSSProperties = {
    opacity: visible ? 1 : 0,
    transform: visible ? "none" : "translateY(28px)",
    transition: `opacity .9s cubic-bezier(.2,.7,.2,1) ${delay}ms, transform .9s cubic-bezier(.2,.7,.2,1) ${delay}ms`,
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref} style={{ ...style, ...revealStyle }} {...rest}>
      {children}
    </Tag>
  );
}
