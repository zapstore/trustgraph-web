import styles from './App.module.css';
import { For, createSignal } from 'solid-js';
import { createMutable } from "solid-js/store";
import { SimplePool } from "nostr-tools/pool";
import { decode, npubEncode } from 'nostr-tools/nip19';

const users = createMutable({});

export const pool = new SimplePool();

function App() {
  const [source, setSource] = createSignal('');
  const [target, setTarget] = createSignal('');

  const [responseAuthors, setResponseAuthors] = createSignal(null);
  const [isDirectFollow, setDirectFollow] = createSignal(false);
  const [isCalculated, setCalculated] = createSignal(false);
  const [relays, setRelays] = createSignal('wss://relay.damus.io, wss://relay.nostr.band');
  const [isVerified, setVerified] = createSignal(false);
  const [isError, setError] = createSignal('');

  const calculate = async (source, target, all) => {
    setCalculated(true);
    try {
      const response = await fetch(`https://trustgraph.live/api/fwf/${source}/${target}${all ? '?all=true' : ''}`);
      if (response.status == 400) {
        setError(await response.text());
        return;
      }
      const data = await response.json();
      const requestAuthors = [source, target].map((e) => decode(e).data);
      const responseAuthors = Object.keys(data).filter(e => e !== source && e !== target).map((e) => decode(e).data);
      const r = await pool.querySync(relays().split(',').map(r => r.trim()), { kinds: [0], authors: [...requestAuthors, ...responseAuthors] });
      for (const e of r) {
        users[e.pubkey] = JSON.parse(e.content);
      }
      setResponseAuthors(responseAuthors);
      setDirectFollow(Object.keys(data).includes(source));
    } catch (e) {
      setError(e.message);
    }
  };

  const verify = async (authors) => {
    setVerified(true);
    try {
      const r = await pool.querySync(relays().split(',').map(r => r.trim()), { kinds: [3], authors });
      for (const e of r) {
        const user = users[e.pubkey];
        if (user) {
          user.follows = e.tags.filter(t => t[0] == 'p').map(t => t[1]);
        }
      }
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div class={styles.App}>
      <h1>nostr trustgraph</h1>
      <p>Calculate <strong><code>source</code>'s follows who follow <code>target</code></strong> from the trustgraph API, sorted by PageRank.</p>
      <p><strong>Alpha software</strong>, expect bugs! More APIs coming soon.</p>
      <p><br/></p>

      <label for="source">Source npub:</label>
      <input disabled={isCalculated()} type="text" name="source" required value={source()} onChange={(e) => setSource(e.target.value)} />

      <label for="target">Target npub:</label>
      <input disabled={isCalculated()} type="text" name="target" required value={target()} onChange={(e) => setTarget(e.target.value)} />
      
      <label for="relays">Comma-separated list of relays:</label>
      <input disabled={isCalculated()} type="text" name="relays" required value={relays()} onChange={(e) => setRelays(e.target.value)} />

      <button disabled={isCalculated()} onClick={() => calculate(source(), target())}>Return top 5 follows</button>
      <button disabled={isCalculated()} onClick={() => calculate(source(), target(), true)}>Return all follows</button>

      <Show when={isError()}>
        <div class={styles.error}>An error occured: {isError()}</div>
      </Show>

      <Show when={isDirectFollow()}>
        <div class={styles.result}>
          <Avatar pubkey={decode(source()).data} checkFollows={responseAuthors()} suffix="follows" />
          <Avatar pubkey={decode(target()).data} suffix="directly" />
        </div>
      </Show>
      
      <Show when={responseAuthors()}>
        <div class={styles.result}>
          <Avatar pubkey={decode(source()).data} checkFollows={responseAuthors()} suffix={isDirectFollow() ? `also follows` : `follows`} />
            <For each={responseAuthors()} fallback={<div/>}>
              {f => <div class={styles.follows}><Avatar pubkey={f} checkFollows={[decode(target()).data]} /></div>}
            </For>
          <Avatar pubkey={decode(target()).data} prefix={responseAuthors().length ? "who all follow" : "no one who follows"} />
        </div>
      </Show>

      <Show when={isCalculated() && !responseAuthors()}>
        <div class={styles.result}>
          <svg class={styles.spinner} viewBox="0 0 50 50">
            <circle class={styles.path} cx="25" cy="25" r="10" fill="none" stroke-width="5"></circle>
          </svg>
        </div>
      </Show>
      
      <p>Once the result is returned from the API, verify its validity by pulling contact lists from chosen relays. You should see a green verified icon <span class={styles.icon}>{verifiedSvg()}</span> next to each verified contact list, and a yellow warning icon <span class={styles.icon}>{warningSvg()}</span> if something did not add up in that contact list.</p>
      
      <button disabled={isVerified()} onClick={() => verify([decode(source()).data, ...responseAuthors()])}>Verify result client-side</button>
      <p>Refresh the page for a new request.</p>
      <p>Source code: <u><a href="https://github.com/zapstore/trustgraph">API</a></u> and <u><a href="https://github.com/zapstore/trustgraph-web">web client</a></u>.</p>
    </div>
  );
}

export default App;

function Avatar(props) {
  const user = () => {
    return users[props.pubkey];
  };
  if (!user()) {
    return <div></div>;
  }
  return <div class={styles.row}>
    <div class={styles.prefix}>
      <u>{props.prefix}</u>
    </div>
    <div class={styles.avatar}>
      <img src={user().image || user().picture} />
    </div>
    <div class={styles.name}>
      {user().displayName || user().display_name || user().name} (<a href={`https://nostr.com/${npubEncode(props.pubkey)}`}>{user().nip05 || `${npubEncode(props.pubkey).substring(0, 14)}...`}</a>)
        <Show when={user().follows}>
          &nbsp;[following {user().follows && user().follows.length}] 
            {props.checkFollows && props.checkFollows.every(v => user().follows.includes(v)) && <span class={styles.icon}>{verifiedSvg()}</span>}
            {props.checkFollows && !props.checkFollows.every(v => {
              const result = user().follows.includes(v);
              if (!result) {
                console.log(props.pubkey, v);
              }
              return result;
            }) && <span class={styles.icon}>{warningSvg()}</span>}
        </Show>
    </div>
    <div class={styles.prefix}>
      <u>{props.suffix}</u>
    </div>
  </div>;
}

const verifiedSvg = () => <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M9.5924 3.20027C9.34888 3.4078 9.22711 3.51158 9.09706 3.59874C8.79896 3.79854 8.46417 3.93721 8.1121 4.00672C7.95851 4.03705 7.79903 4.04977 7.48008 4.07522C6.6787 4.13918 6.278 4.17115 5.94371 4.28923C5.17051 4.56233 4.56233 5.17051 4.28923 5.94371C4.17115 6.278 4.13918 6.6787 4.07522 7.48008C4.04977 7.79903 4.03705 7.95851 4.00672 8.1121C3.93721 8.46417 3.79854 8.79896 3.59874 9.09706C3.51158 9.22711 3.40781 9.34887 3.20027 9.5924C2.67883 10.2043 2.4181 10.5102 2.26522 10.8301C1.91159 11.57 1.91159 12.43 2.26522 13.1699C2.41811 13.4898 2.67883 13.7957 3.20027 14.4076C3.40778 14.6511 3.51158 14.7729 3.59874 14.9029C3.79854 15.201 3.93721 15.5358 4.00672 15.8879C4.03705 16.0415 4.04977 16.201 4.07522 16.5199C4.13918 17.3213 4.17115 17.722 4.28923 18.0563C4.56233 18.8295 5.17051 19.4377 5.94371 19.7108C6.278 19.8288 6.6787 19.8608 7.48008 19.9248C7.79903 19.9502 7.95851 19.963 8.1121 19.9933C8.46417 20.0628 8.79896 20.2015 9.09706 20.4013C9.22711 20.4884 9.34887 20.5922 9.5924 20.7997C10.2043 21.3212 10.5102 21.5819 10.8301 21.7348C11.57 22.0884 12.43 22.0884 13.1699 21.7348C13.4898 21.5819 13.7957 21.3212 14.4076 20.7997C14.6511 20.5922 14.7729 20.4884 14.9029 20.4013C15.201 20.2015 15.5358 20.0628 15.8879 19.9933C16.0415 19.963 16.201 19.9502 16.5199 19.9248C17.3213 19.8608 17.722 19.8288 18.0563 19.7108C18.8295 19.4377 19.4377 18.8295 19.7108 18.0563C19.8288 17.722 19.8608 17.3213 19.9248 16.5199C19.9502 16.201 19.963 16.0415 19.9933 15.8879C20.0628 15.5358 20.2015 15.201 20.4013 14.9029C20.4884 14.7729 20.5922 14.6511 20.7997 14.4076C21.3212 13.7957 21.5819 13.4898 21.7348 13.1699C22.0884 12.43 22.0884 11.57 21.7348 10.8301C21.5819 10.5102 21.3212 10.2043 20.7997 9.5924C20.5922 9.34887 20.4884 9.22711 20.4013 9.09706C20.2015 8.79896 20.0628 8.46417 19.9933 8.1121C19.963 7.95851 19.9502 7.79903 19.9248 7.48008C19.8608 6.6787 19.8288 6.278 19.7108 5.94371C19.4377 5.17051 18.8295 4.56233 18.0563 4.28923C17.722 4.17115 17.3213 4.13918 16.5199 4.07522C16.201 4.04977 16.0415 4.03705 15.8879 4.00672C15.5358 3.93721 15.201 3.79854 14.9029 3.59874C14.7729 3.51158 14.6511 3.40781 14.4076 3.20027C13.7957 2.67883 13.4898 2.41811 13.1699 2.26522C12.43 1.91159 11.57 1.91159 10.8301 2.26522C10.5102 2.4181 10.2043 2.67883 9.5924 3.20027ZM16.3735 9.86314C16.6913 9.5453 16.6913 9.03 16.3735 8.71216C16.0557 8.39433 15.5403 8.39433 15.2225 8.71216L10.3723 13.5624L8.77746 11.9676C8.45963 11.6498 7.94432 11.6498 7.62649 11.9676C7.30866 12.2854 7.30866 12.8007 7.62649 13.1186L9.79678 15.2889C10.1146 15.6067 10.6299 15.6067 10.9478 15.2889L16.3735 9.86314Z" fill="#3e8e41"/>
</svg>;

const warningSvg = () => <svg viewBox="0 0 512 512" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
    <g id="add" fill="#FFBF00" transform="translate(32.000000, 42.666667)">
        <path d="M246.312928,5.62892705 C252.927596,9.40873724 258.409564,14.8907053 262.189374,21.5053731 L444.667042,340.84129 C456.358134,361.300701 449.250007,387.363834 428.790595,399.054926 C422.34376,402.738832 415.04715,404.676552 407.622001,404.676552 L42.6666667,404.676552 C19.1025173,404.676552 7.10542736e-15,385.574034 7.10542736e-15,362.009885 C7.10542736e-15,354.584736 1.93772021,347.288125 5.62162594,340.84129 L188.099293,21.5053731 C199.790385,1.04596203 225.853517,-6.06216498 246.312928,5.62892705 Z M224,272 C208.761905,272 197.333333,283.264 197.333333,298.282667 C197.333333,313.984 208.415584,325.248 224,325.248 C239.238095,325.248 250.666667,313.984 250.666667,298.624 C250.666667,283.264 239.238095,272 224,272 Z M245.333333,106.666667 L202.666667,106.666667 L202.666667,234.666667 L245.333333,234.666667 L245.333333,106.666667 Z" id="Combined-Shape">
</path>
    </g>
</g>
</svg>;