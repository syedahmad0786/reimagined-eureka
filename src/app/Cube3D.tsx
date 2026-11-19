import { useEffect, useRef } from 'preact/hooks';
import { CubeView } from '../viewer';

interface Props {
  onReady: (view: CubeView) => void;
  interactive?: boolean;
  labels?: boolean;
  class?: string;
}

export function Cube3D({ onReady, interactive = true, labels = true, class: cls }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = new CubeView(ref.current as HTMLDivElement, { interactive, faceLabels: labels });
    onReady(view);
    return () => view.dispose();
  }, []);
  return <div ref={ref} class={cls} />;
}
