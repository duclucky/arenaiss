const signalDots = Array.from({ length: 9 }, (_, index) => index);

export function LiveActivitySignal() {
  return <div className="evaluation-progress__signal" aria-hidden="true">
    {signalDots.map((index) => <span className="evaluation-progress__signal-dot" key={index} />)}
  </div>;
}
