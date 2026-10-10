/**
 * Status Card Module
 * Provides centralized handling for status card state, icons, colors, and borders.
 * Used across download.js, download-bundle.js, download-p2p.js, and webui-main.js for consistency.
 */

/**
 * Status types with their associated styling
 */
export const StatusType = {
  PRIMARY: 'primary',     // In progress, default
  SUCCESS: 'success',     // Completed successfully
  DANGER: 'danger',       // Error state
  WARNING: 'warning',     // Disconnection or warning
};

/**
 * Common icons for different states
 */
export const Icons = {
  // Download states
  DOWNLOAD: 'download',
  DOWNLOAD_ENCRYPTED: 'shield_lock',

  // P2P states
  SYNC: 'sync_alt',
  WIFI_TETHERING: 'wifi_tethering',
  LINK_OFF: 'link_off',

  // Upload states
  UPLOAD: 'cloud_upload',

  // Status icons
  SUCCESS: 'check_circle',
  ERROR: 'error',
  WARNING: 'warning',
};

/**
 * Update a status card's visual state
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.card - The card element to update
 * @param {HTMLElement} options.iconContainer - The icon container element
 * @param {HTMLElement} [options.titleEl] - The title element (optional)
 * @param {HTMLElement} [options.messageEl] - The message element (optional)
 * @param {string} options.status - One of StatusType values
 * @param {string} [options.icon] - Material icon name (optional)
 * @param {string} [options.title] - Title text (optional)
 * @param {string} [options.message] - Message text (optional)
 */
export function updateStatusCard({
  card,
  iconContainer,
  titleEl,
  messageEl,
  status,
  icon,
  title,
  message,
}) {
  if (!card) return;

  // Update border color
  card.classList.remove('border-primary', 'border-success', 'border-danger', 'border-warning');
  card.classList.add('border', `border-${status}`);

  // Update icon if container and icon provided
  if (iconContainer && icon) {
    iconContainer.className = `mb-3 text-${status}`;
    iconContainer.innerHTML = `<span class="material-icons-round">${icon}</span>`;
  }

  // Update title if element and text provided
  if (titleEl && title !== undefined) {
    titleEl.textContent = title;
  }

  // Update message if element and text provided
  if (messageEl && message !== undefined) {
    messageEl.textContent = message;
  }
}

/**
 * Set status card to loading/in-progress state
 */
export function setStatusLoading({
  card,
  iconContainer,
  titleEl,
  messageEl,
  icon = Icons.DOWNLOAD,
  title = 'Loading...',
  message = 'Please wait...',
}) {
  updateStatusCard({
    card,
    iconContainer,
    titleEl,
    messageEl,
    status: StatusType.PRIMARY,
    icon,
    title,
    message,
  });
}

/**
 * Set status card to success state
 */
export function setStatusSuccess({
  card,
  iconContainer,
  titleEl,
  messageEl,
  icon = Icons.SUCCESS,
  title = 'Success!',
  message = 'Operation completed successfully.',
}) {
  updateStatusCard({
    card,
    iconContainer,
    titleEl,
    messageEl,
    status: StatusType.SUCCESS,
    icon,
    title,
    message,
  });
}

/**
 * Set status card to error state
 */
export function setStatusError({
  card,
  iconContainer,
  titleEl,
  messageEl,
  icon = Icons.ERROR,
  title = 'Error',
  message = 'An error occurred.',
}) {
  updateStatusCard({
    card,
    iconContainer,
    titleEl,
    messageEl,
    status: StatusType.DANGER,
    icon,
    title,
    message,
  });
}

/**
 * Set status card to warning/disconnected state
 */
export function setStatusWarning({
  card,
  iconContainer,
  titleEl,
  messageEl,
  icon = Icons.WARNING,
  title = 'Warning',
  message = 'Something needs attention.',
}) {
  updateStatusCard({
    card,
    iconContainer,
    titleEl,
    messageEl,
    status: StatusType.WARNING,
    icon,
    title,
    message,
  });
}

/**
 * Remove border styling from card (for neutral state)
 */
export function clearStatusBorder(card) {
  if (!card) return;
  card.classList.remove('border-primary', 'border-success', 'border-danger', 'border-warning');
}
