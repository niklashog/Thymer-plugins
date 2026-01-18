class Plugin extends AppPlugin {
   async onLoad() {
      // Storage keys for persisting the stats
      const HEADS_KEY = 'coin-flip-heads-count';
      const TAILS_KEY = 'coin-flip-tails-count';
      const EDGE_KEY = 'coin-flip-edge-count';

      // Load existing stats or default to zero
      let headsCount = parseInt(localStorage.getItem(HEADS_KEY) || '0');
      let tailsCount = parseInt(localStorage.getItem(TAILS_KEY) || '0');
      let edgeCount = parseInt(localStorage.getItem(EDGE_KEY) || '0');
      let isFlipping = false;

      // Helper to generate the hover tooltip text
      const getStatsString = () => {
         let stats = `Heads: ${headsCount} | Tails: ${tailsCount}`;
         if (edgeCount > 0) stats += ` | Edge: ${edgeCount}`;
         return stats;
      };

      // Cryptographically secure randomness
      const getSecureRandom = () => {
         const array = new Uint32Array(1);
         window.crypto.getRandomValues(array);
         return array[0] / (0xFFFFFFFF + 1);
      };

      const flipCoin = () => {
         if (isFlipping) return;
         isFlipping = true;

         // Smooth Unicode spinner frames for the "Tossing" phase
         const tossingFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
         let frameIndex = 0;

         // Start the tossing animation immediately
         const animTimer = setInterval(() => {
            const spinner = tossingFrames[frameIndex % tossingFrames.length];
            this.statusBarItem.setLabel(`${spinner} TOSSING ${spinner}`);
            frameIndex++;
         }, 80);

         // Random duration for the toss
         const landingDelay = Math.floor(getSecureRandom() * 1000) + 1200;

         setTimeout(() => {
            clearInterval(animTimer);
            finalizeFlip();
         }, landingDelay);

         const finalizeFlip = () => {
            const roll = getSecureRandom();
            let resultText = '';
            let labelText = '';

            if (roll < 0.01) {
               edgeCount++;
               localStorage.setItem(EDGE_KEY, edgeCount.toString());
               resultText = "IMPOSSIBLE! Edge!";
               labelText = "🤯 EDGE 🤯";
            } else if (roll < 0.505) {
               headsCount++;
               localStorage.setItem(HEADS_KEY, headsCount.toString());
               resultText = 'Heads';
               labelText = "🪙 HEADS 🪙";
            } else {
               tailsCount++;
               localStorage.setItem(TAILS_KEY, tailsCount.toString());
               resultText = 'Tails';
               labelText = "✨ TAILS ✨";
            }

            this.statusBarItem.setLabel(labelText);
            this.statusBarItem.setTooltip(getStatsString());
            
            this.ui.addToaster({
               title: 'Coin Flip',
               message: `Result: ${resultText}`,
               autoDestroyTime: 3000,
               type: roll < 0.01 ? 'warning' : 'success'
            });

            setTimeout(() => {
               this.statusBarItem.setLabel("🪙");
               isFlipping = false;
            }, 2500);
         };
      };

      // Initialize the status bar item
      this.statusBarItem = this.ui.addStatusBarItem({
         label: "🪙",
         tooltip: getStatsString(),
         onClick: () => flipCoin()
      });

      // Explicitly register the Reset command
      this.ui.addCommandPaletteCommand({
         label: 'Coin Flip: Reset Counter',
         icon: 'trash',
         onSelected: () => {
            headsCount = 0; tailsCount = 0; edgeCount = 0;
            localStorage.setItem(HEADS_KEY, '0');
            localStorage.setItem(TAILS_KEY, '0');
            localStorage.setItem(EDGE_KEY, '0');
            this.statusBarItem.setTooltip(getStatsString());
            this.ui.addToaster({ 
               title: 'Coin Flip', 
               message: 'Statistics have been reset', 
               autoDestroyTime: 3000,
               type: 'success' 
            });
         }
      });

      // Explicitly register the Flip command
      this.ui.addCommandPaletteCommand({
         label: 'Coin Flip: Toss Coin',
         icon: 'coin',
         onSelected: () => flipCoin()
      });
   }

   onUnload() {
      // Clean up UI elements when plugin is disabled/reloaded
      if (this.statusBarItem) {
         this.statusBarItem.remove();
      }
   }
}
