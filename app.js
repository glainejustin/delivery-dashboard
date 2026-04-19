const socket = io();

// Local caching of state
let deliveries = [];
let sortableInstance = null;

function formatTime(minutesToAdd) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutesToAdd);
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getEtaHtml(delivery) {
    if (delivery.status === 'canceled') {
        return `<div class="eta-content inactive"><div class="eta-title">CANCELED</div></div>`;
    }
    if (delivery.progress === 0) {
        return `<div class="eta-content inactive"><div class="eta-title">ETA --</div></div>`;
    }
    if (delivery.progress === 100) {
        return `<div class="eta-content inactive"><div class="eta-title">AT RECEIVER</div></div>`;
    }

    let timeLeft = delivery.direction === 'out' 
        ? ((100 - delivery.progress) / 100) * delivery.totalTripTime
        : (delivery.progress / 100) * delivery.totalTripTime;
        
    let label = delivery.direction === 'out' ? 'Recv ETA' : 'Return ETA';
    timeLeft = Math.round(timeLeft);
    const arrivalTime = formatTime(timeLeft);
    
    return `
        <div class="eta-content active">
            <div class="eta-title">${label} [${timeLeft}m]</div>
            <div class="eta-time">${arrivalTime}</div>
        </div>
    `;
}

function getMiniEta(delivery) {
    return ""; // No longer used
}

function getActionHtml(delivery) {
    if (delivery.status === 'canceled') return '';
    
    let goText = 'GO ➔';
    let retText = '⬅ RETURN';
    let goClass = 'go-btn';
    let retClass = 'return-btn';
    
    if (delivery.isAuto) {
        if (delivery.direction === 'out') {
            goText = '❚❚ PAUSE';
            goClass = 'pause-btn';
            retClass = 'return-btn dim-btn';
        } else {
            retText = '❚❚ PAUSE';
            retClass = 'pause-btn';
            goClass = 'go-btn dim-btn';
        }
    } else {
        if (delivery.progress === 100) goClass = 'go-btn dim-btn';
        if (delivery.progress === 0) retClass = 'return-btn dim-btn';
    }

    return `
        <div style="display: flex; gap: 8px; width: 100%;">
            <button class="action-btn ${retClass}" onclick="socket.emit('setDirection', {id: '${delivery.id}', dir: 'in'})">${retText}</button>
            <button class="action-btn ${goClass}" onclick="socket.emit('setDirection', {id: '${delivery.id}', dir: 'out'})">${goText}</button>
        </div>
    `;
}

function renderDeliveries() {
    const container = document.getElementById('deliveryList');
    
    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }
    container.innerHTML = '';
    
    deliveries.forEach(delivery => {
        const isCanceled = delivery.status === 'canceled';
        const activeClass = (delivery.progress > 0 && delivery.progress < 100) ? 'true' : 'false';
        
        const row = document.createElement('div');
        row.className = 'delivery-row';
        row.setAttribute('data-id', delivery.id);
        row.setAttribute('data-active', activeClass);
        row.setAttribute('data-direction', delivery.direction);
        
        row.innerHTML = `
            <div class="delivery-info">
                <div class="delivery-name-wrap">
                    <div style="display: flex; flex-direction: column;">
                        <div class="delivery-name">
                            <span class="${isCanceled ? 'strikethrough' : ''}">${delivery.name}</span>
                        </div>
                        <select class="van-reg-select" onchange="updateVanReg('${delivery.id}', this.value)" ${isCanceled ? 'disabled' : ''}>
                            <option value="" ${!delivery.vanReg ? 'selected' : ''}>-- NO VAN --</option>
                            ${['HXH', 'HXF', 'HXJ'].includes(delivery.vanReg) ? '' : (delivery.vanReg ? `<option value="${delivery.vanReg}" selected>${delivery.vanReg}</option>` : '')}
                            <option value="HXH" ${delivery.vanReg === 'HXH' ? 'selected' : ''}>HXH</option>
                            <option value="HXF" ${delivery.vanReg === 'HXF' ? 'selected' : ''}>HXF</option>
                            <option value="HXJ" ${delivery.vanReg === 'HXJ' ? 'selected' : ''}>HXJ</option>
                        </select>
                    </div>
                    ${!isCanceled ? `<div class="edit-icon" onclick="openEditStoreModal('${delivery.id}')"><i class="fas fa-pen"></i></div>` : ''}
                </div>
                <div class="delivery-action" id="action-${delivery.id}">
                    ${getActionHtml(delivery)}
                </div>
            </div>
            <div class="delivery-slider-container">
                <div class="slider-labels">
                    <span class="label-in">CARGO</span>
                    <span class="label-out">UNDERCOFT</span>
                </div>
                <div class="slider-wrapper">
                    <input type="range" min="0" max="100" step="0.01" value="${delivery.progress}" class="delivery-slider" ${isCanceled ? 'disabled' : ''} data-id="${delivery.id}">
                </div>
            </div>
            <div class="delivery-eta-box" id="eta-box-${delivery.id}">
                ${getEtaHtml(delivery)}
            </div>
        `;
        
        container.appendChild(row);
        
        const input = row.querySelector('.delivery-slider');
        updateSliderStyle(input, delivery);
        input.addEventListener('input', (e) => handleSliderChange(e, delivery.id));
    });
    
    sortableInstance = new Sortable(container, {
        animation: 150,
        handle: '.delivery-name-wrap',
        onEnd: function () {
            const newOrderIds = Array.from(container.children).map(row => row.getAttribute('data-id'));
            socket.emit('reorderStores', newOrderIds);
        }
    });
}

function updateSliderStyle(input, delivery) {
    input.style.setProperty('--val', `${delivery.progress}%`);
    input.classList.remove('delivering', 'returning');
    
    if (delivery.status === 'canceled') {
        input.style.setProperty('--fill-color', '#cbd5e1');
        return;
    }
    if (delivery.progress === 0 || delivery.progress === 100) {
        input.style.setProperty('--fill-color', '#94a3b8');
        return;
    }
    if (delivery.direction === 'out') {
        input.classList.add('delivering');
    } else if (delivery.direction === 'in') {
        input.classList.add('returning');
    }
}

// Emits to Server
function handleSliderChange(event, id) {
    const newValue = parseFloat(event.target.value);
    // Instant local feedback
    const input = event.target;
    input.style.setProperty('--val', `${newValue}%`);
    
    socket.emit('manualDrag', {id, newValue});
}

function toggleDeliveryAuto(id) {
    socket.emit('toggleAuto', id);
}

// Listen from Server
socket.on('fullSync', (serverData) => {
    deliveries = serverData;
    renderDeliveries();
});

socket.on('stateUpdate', (serverData) => {
    // Structural changes caught by fullSync, this is for live slider movement
    if (serverData.length !== deliveries.length) {
        deliveries = serverData;
        renderDeliveries();
        return;
    }

    deliveries = serverData;
    deliveries.forEach(delivery => {
        const input = document.querySelector(`.delivery-slider[data-id="${delivery.id}"]`);
        if (input) {
            input.value = delivery.progress;
            updateSliderStyle(input, delivery);
        }
        
        const etaBox = document.getElementById(`eta-box-${delivery.id}`);
        if(etaBox) etaBox.innerHTML = getEtaHtml(delivery);
        
        const actionBox = document.getElementById(`action-${delivery.id}`);
        if(actionBox) actionBox.innerHTML = getActionHtml(delivery);

        const row = document.querySelector(`.delivery-row[data-id="${delivery.id}"]`);
        if (row) {
            const isActive = delivery.progress > 0 && delivery.progress < 100;
            row.setAttribute('data-active', isActive.toString());
            row.setAttribute('data-direction', delivery.direction);
        }
    });
});

// Periodic ETA refresh
setInterval(() => {
    deliveries.forEach(delivery => {
        if (delivery.progress > 0 && delivery.progress < 100) {
            const etaBox = document.getElementById(`eta-box-${delivery.id}`);
            if (etaBox) {
                etaBox.innerHTML = getEtaHtml(delivery);
            }
        }
    });
}, 60000);

// --- Store Modals ---
let editingStoreId = null;

function openStoreModal() {
    editingStoreId = null;
    document.getElementById('modalTitle').innerText = 'Add Store';
    document.getElementById('storeNameInput').value = '';
    document.getElementById('tripTimeInput').value = '30';
    document.getElementById('vanRegInput').value = '';
    document.getElementById('deleteStoreBtn').style.display = 'none';
    document.getElementById('storeModal').style.display = 'flex';
}

function setVanReg(val) {
    document.getElementById('vanRegInput').value = val;
}

function openEditStoreModal(id) {
    const delivery = deliveries.find(d => d.id === id);
    if (!delivery) return;
    editingStoreId = id;
    document.getElementById('modalTitle').innerText = 'Edit Store';
    document.getElementById('storeNameInput').value = delivery.name;
    document.getElementById('tripTimeInput').value = delivery.totalTripTime;
    document.getElementById('vanRegInput').value = delivery.vanReg || '';
    document.getElementById('deleteStoreBtn').style.display = 'block';
    document.getElementById('storeModal').style.display = 'flex';
}

function closeStoreModal() {
    document.getElementById('storeModal').style.display = 'none';
}

// --- Van Reg Update ---
function updateVanReg(id, newReg) {
    const delivery = deliveries.find(d => d.id === id);
    if (!delivery) return;

    socket.emit('saveStore', {
        id: delivery.id,
        name: delivery.name,
        time: delivery.totalTripTime,
        vanReg: newReg
    });
}

function saveStore() {
    const name = document.getElementById('storeNameInput').value.trim();
    const time = parseInt(document.getElementById('tripTimeInput').value) || 30;
    const vanReg = document.getElementById('vanRegInput').value.trim();
    if (!name) return alert('Name required');

    socket.emit('saveStore', {
        id: editingStoreId, 
        name: name,
        time: time,
        vanReg: vanReg
    });
    
    closeStoreModal();
}

function deleteCurrentStore() {
    if (!editingStoreId) return;
    socket.emit('deleteStore', editingStoreId);
    closeStoreModal();
}

