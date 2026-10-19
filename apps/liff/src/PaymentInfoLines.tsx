import { copyText } from './components';
import { parsePaymentInfo } from './lib/payment';

/**
 * Payment info shown line by line, with a copy button for each account or
 * phone number (copied as digits only). Info without any number can still be
 * copied as a whole.
 */
export function PaymentInfoLines({
  info,
  notify,
  className,
}: {
  info: string;
  notify: (message: string) => void;
  className?: string;
}) {
  const lines = parsePaymentInfo(info);
  const hasNumbers = lines.some((l) => l.numbers.length > 0);
  const copy = async (text: string, message: string) => (await copyText(text)) && notify(message);

  return (
    <span className={`payment-lines ${className ?? ''}`}>
      {lines.map((line, i) => (
        <span key={i} className="payment-line">
          <span className="payment-line-text">{line.text}</span>
          {line.numbers.map((n) => (
            <button
              key={n.text}
              type="button"
              className="copy-chip"
              onClick={() => copy(n.digits, `已複製 ${n.digits}`)}
              aria-label={`複製 ${n.text}`}
            >
              {line.numbers.length > 1 ? `複製 …${n.digits.slice(-4)}` : '複製'}
            </button>
          ))}
          {!hasNumbers && i === lines.length - 1 && (
            <button type="button" className="copy-chip" onClick={() => copy(info, '已複製收款資訊')}>
              複製
            </button>
          )}
        </span>
      ))}
    </span>
  );
}
