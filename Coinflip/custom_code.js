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

         // Determine how long the "toss" lasts (between 1.2 and 2.2 seconds)
         const landingDelay = Math.floor(getSecureRandom() * 1000) + 1200;

         setTimeout(() => {
            clearInterval(animTimer);
            finalizeFlip();
         }, landingDelay);

         const finalizeFlip = () => {
            const roll = getSecureRandom();
            let resultText = '';
            let labelText = '';

            if (roll < 0.01) { // 1% Easter Egg: Edge
               edgeCount++;
               localStorage.setItem(EDGE_KEY, edgeCount.toString());
               resultText = "IMPOSSIBLE! Edge!";
               labelText = "🤯 EDGE 🤯";
            } else if (roll < 0.505) {
               headsCount++;
               localStorage.setItem(HEADS_KEY, headsCount.toString());
               resultText = 'Heads';
               // Updated to use coin emojis instead of stars
               labelText = "🪙 HEADS 🪙";
            } else {
               tailsCount++;
               localStorage.setItem(TAILS_KEY, tailsCount.toString());
               resultText = 'Tails';
               // Updated to use coin emojis instead of stars
               labelText = "🪙 TAILS 🪙";
            }

            // Update UI with final result
            this.statusBarItem.setLabel(labelText);
            this.statusBarItem.setTooltip(getStatsString());
            
            this.ui.addToaster({
               title: 'Coin Flip',
               message: `Result: ${resultText}`,
               autoDestroyTime: 3000,
               type: roll < 0.01 ? 'warning' : 'success'
            });

            // Reset to the simple coin icon after 2.5 seconds
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
   }

   onUnload() {
      if (this.statusBarItem) {
         this.statusBarItem.remove();
      }
   }
}