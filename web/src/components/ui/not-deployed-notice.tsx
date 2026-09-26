import styles from './ui.module.css';

/** Clean "not deployed yet" state shown whenever a required NEXT_PUBLIC_* address is unset (issue #16 fills
 *  these in). `envVars` names the exact vars a reader needs to set to light the feature up. */
export function NotDeployedNotice({
  title,
  body,
  envVars,
}: {
  title: string;
  body: string;
  envVars?: readonly string[];
}) {
  return (
    <div className={styles.notice} role="status">
      <span className={styles.noticeIcon} aria-hidden />
      <div>
        <p className={styles.noticeTitle}>{title}</p>
        <p className={styles.noticeBody}>{body}</p>
        {envVars && envVars.length > 0 ? (
          <ul className={styles.noticeList}>
            {envVars.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
