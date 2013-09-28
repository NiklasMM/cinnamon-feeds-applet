/*
 * Cinnamon RSS feed reader applet
 *
 * Author: jonbrett.dev@gmail.com
 * Date: 2013
 *
 * Cinnamon RSS feed reader applet is free software: you can redistribute it
 * and/or modify it under the terms of the GNU General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * Cinnamon RSS feed reader applet is distributed in the hope that it will be
 * useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General
 * Public License for more details.
 * You should have received a copy of the GNU General Public License along
 * with Cinnamon RSS feed reader applet.  If not, see
 * <http://www.gnu.org/licenses/>.
 */

const UUID = "feeds@jonbrettdev.wordpress.com"

const FEED_IMAGE_HEIGHT_MAX = 100;
const FEED_IMAGE_WIDTH_MAX = 200;
const TOOLTIP_WIDTH = 500.0;

imports.searchPath.push( imports.ui.appletManager.appletMeta[UUID].path );

const Applet = imports.ui.applet;
const FeedReader = imports.feedreader;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gettext = imports.gettext.domain('cinnamon-applets');
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;
const _ = Gettext.gettext;

/* Menu item for displaying a simple message */
function LabelMenuItem() {
    this._init.apply(this, arguments);
}

LabelMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (text, tooltip, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        let label = new St.Label({ text: text });
        this.addActor(label);

        if (this.tooltip != '')
            new Tooltips.Tooltip(this.actor, tooltip);
    },
};

/* Menu item for displaying an feed item */
function FeedMenuItem() {
    this._init.apply(this, arguments);
}

FeedMenuItem.prototype = {
    __proto__: Applet.MenuItem.prototype,

    _init: function (item, params) {
        this.item = item;
        if (this.item.read)
            this._icon = 'feed-symbolic';
        else
            this._icon = 'feed-new-symbolic';

        Applet.MenuItem.prototype._init.call(this,
                FeedReader.html2text(item.title),
                this._icon,
                Lang.bind(this, function() {
                    this.read_item();
                }));
        this.icon.icon_type = St.IconType.SYMBOLIC;

        let tooltip = new Tooltips.Tooltip(this.actor,
                FeedReader.html2text(item.description));

        /* Some hacking of the underlying tooltip ClutterText to set wrapping,
         * format, etc */
        try {
            tooltip._tooltip.style_class = 'feedreader-item-tooltip';
            tooltip._tooltip.get_clutter_text().set_width(TOOLTIP_WIDTH);
            tooltip._tooltip.get_clutter_text().set_line_alignment(0);
            tooltip._tooltip.get_clutter_text().set_line_wrap(true);
            tooltip._tooltip.get_clutter_text().set_markup(
                    FeedReader.html2pango(item.description));
        } catch (e) {
            /* If we couldn't tweak the tooltip format this is likely because
             * the underlying implementation has changed. Don't issue any
             * failure here */
        }
    },

    read_item: function() {
        this.item.open();

        /* Update icon */
        this.removeActor(this.label);
        this.removeActor(this.icon);
        this._icon = 'feed-symbolic';
        this.icon = new St.Icon({ icon_name: this._icon,
                icon_type: St.IconType.SYMBOLIC,
                style_class: 'popup-menu-icon' });

        this.addActor(this.icon);
        this.addActor(this.label);
    },
};

/* Menu item for displaying the feed title*/
function FeedDisplayMenuItem() {
    this._init.apply(this, arguments);
}

FeedDisplayMenuItem.prototype = {
    __proto__: PopupMenu.PopupSubMenuMenuItem.prototype,

    _init: function (reader, owner, params) {
        PopupMenu.PopupSubMenuMenuItem.prototype._init.call(this, reader.title);

        this.owner = owner;
        this.reader = reader;

        /* Create initial layout for menu title We wrap the main titlebox in a
         * container in order to avoid excessive spacing caused by the
         * mainbox vertical layout */
        this.mainbox = new St.BoxLayout({
            style_class: 'feedreader-title',
            vertical: true
        });
        this.mainbox.add(new St.Label({text:_("_Loading")}));
        let container = new St.BoxLayout();
        container.add(this.mainbox);

        this.statusbox = new St.BoxLayout({
            style_class: 'feedreader-status'
        });

        /* Remove/re-add PopupSubMenuMenuItem actors to insert our own actors
         * in place of the the regular label */
        this.removeActor(this.label);
        this.removeActor(this._triangle);
        this.addActor(this.statusbox);
        this.addActor(container);
        this.addActor(this._triangle, {align: St.Align.END});

        this.update();
    },

    /* Rebuild the feed title, status, items from the feed reader */
    update: function() {

        /* Clear existing actors */
        this.statusbox.destroy_all_children();
        this.mainbox.destroy_all_children();

        /* Use feed image where available for title */
        if (this.reader.image.path != undefined &&
                this.owner.show_feed_image == true) {
            try {
                let image = St.TextureCache.get_default().load_uri_async(
                        GLib.filename_to_uri(this.reader.image.path, null),
                        FEED_IMAGE_WIDTH_MAX,
                        FEED_IMAGE_HEIGHT_MAX);

                let imagebox = new St.BoxLayout({
                    style_class: 'feedreader-title-image',
                });
                imagebox.add(image);

                this.mainbox.add(imagebox, { x_align: St.Align.START, x_fill: false });
            } catch (e) {
                global.logError("Failed to load feed icon: " + this.reader.image.path + ' : ' + e);
            }
        }

        let buttonbox = new St.BoxLayout({
            style_class: 'feedreader-title-buttons'
        });

        buttonbox.add(new St.Label({ text: this.reader.title,
            style_class: 'feedreader-title-label'
        }));

        let button = new St.Button({ reactive: true });
        let icon = new St.Icon({
            icon_name: "web-browser-symbolic",
            style_class: 'popup-menu-icon',
        });
        button.set_child(icon);
        button.url = this.url;
        button.connect('clicked', Lang.bind(this, function(button, event) {
            Util.spawnCommandLine('xdg-open ' + this.url);
            this.owner.menu.close();
        }));

        let tooltip = new Tooltips.Tooltip(button, this.url);
        buttonbox.add(button);

        button = new St.Button({ reactive: true });
        icon = new St.Icon({ icon_name: "object-select-symbolic",
            style_class: 'popup-menu-icon'
        });
        button.set_child(icon);
        button.connect('clicked', Lang.bind(this, function(button, event) {
            this.owner.menu.close();
            this.reader.mark_all_items_read();
            this.owner.build_menu();
        }));
        let tooltip = new Tooltips.Tooltip(button, _("Mark all as read"));
        buttonbox.add(button);

        this.mainbox.add(buttonbox);

        let menu_items = 0;
        let unread_count = 0;
        for (var i = 0; i < this.reader.items.length; i++) {
            let item = new FeedMenuItem(this.reader.items[i]);
            item.connect("activate", function(actor, event) {
                actor.read_item();
            });
            this.menu.addMenuItem(item);

            if (!this.reader.items[i].read)
                unread_count++;

            menu_items++;
        }
    },
};

function FeedApplet() {
    this._init.apply(this, arguments);
}

FeedApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        try {
            this.path = metadata.path;
            this.icon_path = metadata.path + '/icons/';
            Gtk.IconTheme.get_default().append_search_path(this.icon_path);
            this.set_applet_icon_symbolic_name("rss");
            this.set_applet_tooltip(_("Feed reader"));

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

        } catch (e) {
            global.logError(e);
        }

        this.init_settings();

        this.build_context_menu();
    },

    init_settings: function(instance_id) {
        this.settings = new Settings.AppletSettings(this, UUID, this.instance_id);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "refresh_interval", "refresh_interval_mins", this.refresh,
                null);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "url", "url", this.url_changed, null);
        this.url_changed();

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "show_read_items", "show_read_items", this.build_menu, null);
        this.settings.bindProperty(Settings.BindingDirection.IN,
                "max_items", "max_items", this.build_menu, null);
        this.settings.bindProperty(Settings.BindingDirection.IN,
                "show_feed_image", "show_feed_image", this.build_menu, null);
        this.build_menu();
    },

    build_context_menu: function() {
        var s = new Applet.MenuItem(
                _("Mark all read"),
                "object-select-symbolic",
                Lang.bind(this, function() {
                    for (var i = 0; i < this.reader.length; i++)
                        this.reader[i].mark_all_items_read();
                    this.build_menu();
                }));
        s.icon.icon_type = St.IconType.SYMBOLIC;
        this._applet_context_menu.addMenuItem(s);

        var s = new Applet.MenuItem(
                _("Reload"),
                "view-refresh-symbolic",
                Lang.bind(this, function() {
                    this.refresh();
                }));
        s.icon.icon_type = St.IconType.SYMBOLIC;
        this._applet_context_menu.addMenuItem(s);

        s = new Applet.MenuItem(
                _("Settings"),
                "emblem-system-symbolic",
                Lang.bind(this, function() {
                    Util.spawnCommandLine('cinnamon-settings applets ' + UUID);
                }));
        s.icon.icon_type = St.IconType.SYMBOLIC;
        this._applet_context_menu.addMenuItem(s);
    },

    url_changed: function() {
        let url_list = this.url.replace(/\s+/g, " ").replace(/\s*$/, '').replace(/^\s*/, '').split(" ");
        this.reader = new Array();

        for (var i in url_list) {
            this.reader[i] = new FeedReader.FeedReader(
                    url_list[i],
                    '~/.cinnamon/' + UUID + '/' + this.instance_id,
                    {
                        'onUpdate' : Lang.bind(this, this.on_update),
                        'onError' : Lang.bind(this, this.on_error)
                    });
        }
        this.build_menu();
        this.refresh();
    },

    on_update: function() {
        this.build_menu();
    },

    on_error: function(reader, message, full_message) {
        /* Just build the menu - this will interrogate the reader for errors */
        this.build_menu();
    },

    build_menu: function() {

        this.menu.removeAll();
        this.feed_title_items = new Array();

        let applet_has_unread = false;
        let applet_tooltip = "";

        for (var r = 0; r < this.reader.length; r++) {
            if (this.reader[r] == undefined)
                continue;

            this.feed_title_items[r] = new FeedDisplayMenuItem(this.reader[r], this);
            this.menu.addMenuItem(this.feed_title_items[r]);

            let unread_count = 0;
            let menu_items = 0;

            /* Display error message for this reader and continue */
            if (this.reader[r].error) {
                let err_label = new LabelMenuItem(this.reader[r].error_messsage,
                        this.reader[r].error_details);
                this.menu.addMenuItem(err_label);
                continue;
            }

            for (var i = 0; i < this.reader[r].items.length && menu_items < this.max_items; i++) {
                if (!this.show_read_items && this.reader[r].items[i].read)
                    continue;

                if (!this.reader[r].items[i].read)
                    unread_count++;

                menu_items++;
            }

            if (0 == menu_items)
                this.menu.addMenuItem(new LabelMenuItem(_("No new items"), ''));


            /* Append to applet tooltip */
            if (r != 0)
                applet_tooltip += '\n';
            if (unread_count > 0) {
                applet_tooltip += this.reader[r].title + ' [' + unread_count + ']';
                applet_has_unread = true;
            } else {
                applet_tooltip += this.reader[r].title;
            }
        }

        if (applet_has_unread)
            this.set_applet_icon_symbolic_name("feed-new");
        else
            this.set_applet_icon_symbolic_name("feed");

        this.set_applet_tooltip(applet_tooltip);
    },


    refresh: function() {
        /* Remove any previous timeout */
        if (this.timer_id) {
            Mainloop.source_remove(this.timer_id);
            this.timer_id = 0;
        }

        /* Get feed data */
        for (var i = 0; i < this.reader.length; i++) {
            if (this.reader[i] != undefined)
                this.reader[i].get();
        }

        /* Convert refresh interval from mins -> ms */
        this.timeout = this.refresh_interval_mins * 60 * 1000;

        /* Set the next timeout */
        this.timer_id = Mainloop.timeout_add(this.timeout,
                Lang.bind(this, this.refresh));
    },

    on_applet_clicked: function(event) {
        this.menu.toggle();
        for (var i = 0; i < this.feed_title_items.length; i++) {
            this.feed_title_items[i].menu.open()
        }
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new FeedApplet(metadata, orientation, panel_height, instance_id);
}
