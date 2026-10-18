

function createListRotator({items,strategy = "sequential"}) {



    let index = 0;
    let usedSet = new Set(); // For shuffle mode

    return function getNextItem() {
        switch (strategy) {
            case "sequential":
                return sequential();
            case "random":
                return random();
            case "shuffle":
                return shuffle();
            default:
                throw new Error("Invalid rotation strategy");
        }
    };

    function sequential() {
        const item = items[index];
        index = (index + 1) % items.length;
        return item;
    }

    function random() {
        return items[Math.floor(Math.random() * items.length)];
    }

    function shuffle() {
        if (usedSet.size === items.length) usedSet.clear();
        let item;
        do {
            item = items[Math.floor(Math.random() * items.length)];
        } while (usedSet.has(item));
        usedSet.add(item);
        return item;
    }
}



module.exports = {
    createListRotator
};