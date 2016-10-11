'use strict';

var vscode_1 = require('vscode');
var notification = require("./notification");
var file_manager = require("./file_manager");
var CTAG_COMMAND = "ctags";
var CTAGS_TAG_FILE_NAME = "ctags.tmp";
var CTAG_OPTION = "-R --fields=-aiklmnSzt+fsK --languages=php --php-kinds=cidf --excmd=number";
var CTAG_OUTLINE_OPTION = "--fields=-aiklmnSzt+fsK --php-kinds=cidf --excmd=number -f -";
var LARGE_FILE_SIZE_BYTE = (50 * 1024 * 1024); // 50MB
var Status;

(function (Status) {
    Status[Status["NONE"] = 0] = "NONE";
    Status[Status["GENERATING"] = 1] = "GENERATING";
    Status[Status["GENERATED"] = 2] = "GENERATED";
    Status[Status["LOADING"] = 3] = "LOADING";
    Status[Status["LOADED"] = 4] = "LOADED";
})(Status || (Status = {}));
;

var CTAG_Manager = (function () {
    function CTAG_Manager() {
        this._ctags_tagpath = "";
        this._current_path = "";
        this._tags = [];
        this._reset_if_need();
    }

    CTAG_Manager.prototype._reset_if_need = function () {
        if (this._current_path != vscode_1.workspace.rootPath) {
            this._current_path = vscode_1.workspace.rootPath;
            this._ctags_tagpath = require('path').join(this._current_path, CTAGS_TAG_FILE_NAME);
            this._status = Status.NONE;
            this._tags = [];
        }
    };

    CTAG_Manager.prototype._set_tagpath = function () {
        this._ctags_tagpath = require('path').join(this._current_path, CTAGS_TAG_FILE_NAME);
    };

    CTAG_Manager.prototype._get_tagpath = function () {
        return this._ctags_tagpath;
    };

    CTAG_Manager.prototype._load_tags = function () {
        if (this._status == Status.LOADING) {
            /* Already in loading, do not run again.*/
            return;
        }
        var manager = this;
        this._status = Status.LOADING;

        if (!file_manager.test_file_size(this._ctags_tagpath, LARGE_FILE_SIZE_BYTE)) {
            notification.print_error("Can't load large ctag file larger than " + LARGE_FILE_SIZE_BYTE / 1024 / 1024 + "MB. Loading has been cancelled");
            return;
        }

        file_manager.parse_file_line(this._ctags_tagpath, function (line) {
            if (line && line[0] != '!') {
                manager._tags.push(line);
            }
        }, function () {
            notification.print_error("Error on loading ctag info.");
            manager._status = Status.NONE;
        }, function () {
            // notification.print_info("Tag information has been loaded. You can search tag now");
            manager._status = Status.LOADED;
        });
    };

    CTAG_Manager.prototype._extract_tag = function (line) {
        var info_array = line.split('\t');
        if (info_array.length < 4) {
            return null;
        }

        var info = {
            symbol: info_array[0],
            file: info_array[1],
            lineNum: parseInt(info_array[2].replace(';"', ''), 10) - 1,
            type: info_array[3]
        };
        return info;
    };

    CTAG_Manager.prototype._goto_tag_on_doc = function (tag_info) {
        tag_info = this._extract_tag(tag_info);

        if (vscode_1.window.activeTextEditor.document.fileName == tag_info.file) {
            this._reveal_line(vscode_1.window.activeTextEditor, tag_info.lineNum)
            return;
        }

        var file = require('path').join(this._current_path, tag_info.file);
        var manager = this;
        vscode_1.workspace.openTextDocument(file).then(function (doc) {
            vscode_1.window.showTextDocument(doc).then(function (editor) {
                manager._reveal_line(editor, tag_info.lineNum)
            });
        }, function (error) {
            vscode_1.window.showErrorMessage("Cannot find the symbol : " + tag_info.symbol);
        });
    };

    CTAG_Manager.prototype._reveal_line = function (editor, lineNumber) {
        var reviewType = vscode_1.TextEditorRevealType.InCenter;
        if (lineNumber == editor.selection.active.line) {
            reviewType = vscode_1.TextEditorRevealType.InCenterIfOutsideViewport;
        }
        var newSe = new vscode_1.Selection(lineNumber, 0, lineNumber, 0);
        editor.selection = newSe;
        editor.revealRange(newSe, reviewType);
    };

    CTAG_Manager.prototype._tag_search = function (targetSymbol) {
        if (!targetSymbol) return;

        var list = [];
        var searchPath = false;
        if (targetSymbol[0] == '@') {
            targetSymbol = targetSymbol.substr(1);
            searchPath = true;
        }
        targetSymbol = targetSymbol.toLowerCase();
        for (var i = 0; i < this._tags.length; i++) {
            var line = this._tags[i];
            var tag = this._extract_tag(line);
            if (searchPath) {
                if (tag.file.toLowerCase().indexOf(targetSymbol) > -1) {
                    list.push(line);
                }
            }
            else if (tag.symbol.toLowerCase().indexOf(targetSymbol) > -1) {
                list.push(line);
            }
        }

        if (list.length > 0) {
            this._show_quick_pick(list, true);
        }
        else {
            notification.print_error("Cannot find the symbol:" + targetSymbol);
        }
    };

    CTAG_Manager.prototype._show_quick_pick = function(list, showPath) {
        var manager = this;
        vscode_1.window.showQuickPick(list.map(function(line) {
            var tag = manager._extract_tag(line);
            if (tag) return tag.symbol + (showPath ? "\t" + tag.file : '');
        }).filter(function(label) {
            return label != undefined;
        })).then(function(label){
            for (var i = 0; i < list.length; i++) {
                if (list[i].indexOf(label) == 0) {
                    manager._goto_tag_on_doc(list[i]);
                }
            }
        });
    };

    CTAG_Manager.prototype._is_large_file = function (file_path) {
        return false;
    };

    CTAG_Manager.prototype.load_tags = function() {
        this._reset_if_need();
        if (this._status != Status.LOADED) {
            if (!file_manager.file_exists(this._get_tagpath())) {
                error("Cannot read ctag file. Please run CTAGS:Generate command first.");
            }
            else this._load_tags();
        }
    };

    CTAG_Manager.prototype.search = function (targetSymbol, error) {
        if (this._status != Status.LOADED) {
            error("Loading tag info.. Please wait for a while and try again");
            return;
        }
        else {
            this._tag_search(targetSymbol);
        }
    };

    CTAG_Manager.prototype.generate_tag = function () {
        this._reset_if_need();
        var parent = this;
        switch (this._status) {
            /* In doing something, do not run again. just return */
            case Status.GENERATING:
            case Status.LOADING:
                return;
        }
        this._status = Status.LOADING;
        var exec = require('child_process').exec;
        var command = CTAG_COMMAND + ' ' + CTAG_OPTION + ' -f ' + CTAGS_TAG_FILE_NAME;
        //Run ctag;
        notification.print_info("Generating ctag file...");
        exec(command, { cwd: parent._current_path }, function (err, stdout, stderr) {
            notification.print_info("Ctag generation has been completed. Loading the tag file low..");
            parent._status = Status.GENERATED;
            parent._load_tags();
        });
    };

    CTAG_Manager.prototype.outline = function() {
        var textEditor = vscode_1.window.activeTextEditor;
        if( textEditor.document.isUntitled ){
            return;
        }
        var parent = this;
        var filePath = textEditor.document.fileName;
        var exec = require('child_process').exec;
        var command = CTAG_COMMAND + ' ' + CTAG_OUTLINE_OPTION + ' "' + filePath + '"';
        exec(command, {}, function (err, stdout, stderr) {
            if (!stdout) return;
            // console.log(stdout);
            var lines = stdout.split("\r\n");
            lines.pop();
            parent._show_quick_pick(lines, false);
        });
    };

    return CTAG_Manager;
}());

exports.CTAG_Manager = CTAG_Manager;
//# sourceMappingURL=ctag_manager.js.map