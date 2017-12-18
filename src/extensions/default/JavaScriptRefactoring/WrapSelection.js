/*
 * Copyright (c) 2013 - present Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

define(function (require, exports, module) {
    "use strict";

    var _ = brackets.getModule("thirdparty/lodash");

    var EditorManager        = brackets.getModule("editor/EditorManager"),
        TokenUtils           = brackets.getModule("utils/TokenUtils"),
        CommandManager       = brackets.getModule("command/CommandManager"),
        Menus                = brackets.getModule("command/Menus"),
        Strings              = brackets.getModule("strings"),
        RefactoringSession   = require("RefactoringUtils");

    //Template keys mentioned in Templates.json
    var WRAP_IN_CONDITION       = "wrapCondition",
        ARROW_FUNCTION          = "arrowFunction",
        GETTERS_SETTERS         = "gettersSetters",
        TRY_CATCH               = "tryCatch";

    //Commands
    var refactorWrapInTryCatch  = "refactoring.wrapintrycatch",
        refactorWrapInCondition = "refactoring.wrapincondition",
        refactorConvertToArrowFn = "refactoring.converttoarrowfunction",
        refactorCreateGetSet = "refactoring.creategettersandsetters";

    //Active session which will contain information about editor, selection etc
    var current = null;

    /**
     * Initialize session
     */
    function initializeRefactoringSession() {
        current = new RefactoringSession(EditorManager.getActiveEditor());
    }

    /**
     * Wrap selected statements
     *
     * @param {string} wrapperName - template name where we want wrap selected statements
     * @param {string} err- error message if we can't wrap selected code
     */
    function _wrapSelectedStatements (wrapperName, err) {
        initializeRefactoringSession();

        var startIndex = current.startIndex,
            endIndex = current.endIndex,
            selectedText = current.selectedText,
            pos;

        if (selectedText.length === 0) {
            var statementNode = current.findSurroundASTNode(current.ast, {start: startIndex}, ["Statement"]);
            selectedText = current.text.substr(statementNode.start, statementNode.end - statementNode.start);
            startIndex = statementNode.start;
            endIndex = statementNode.end;
        } else {
            var selectionDetails = current.normalizeText(selectedText, startIndex, endIndex);
            selectedText = selectionDetails.text;
            startIndex = selectionDetails.start;
            endIndex = selectionDetails.end;
        }

        if (!current.checkStatement(current.ast, startIndex, endIndex, selectedText)) {
            current.editor.displayErrorMessageAtCursor(err);
            return;
        }

        pos = {
            "start": current.cm.posFromIndex(startIndex),
            "end": current.cm.posFromIndex(endIndex)
        };

        current.document.batchOperation(function() {
            current.replaceTextFromTemplate(wrapperName, {body: selectedText}, pos);
        });

        if (wrapperName === TRY_CATCH) {
            current.editor.setSelection({"line": pos.start.line, "ch": pos.start.ch + 5});
        } else if (wrapperName === WRAP_IN_CONDITION) {
            current.editor.setSelection({"line": pos.start.line, "ch": pos.start.ch + 4}, {"line": pos.start.line, "ch": pos.start.ch + 5});
        }
    }


     //Wrap selected statements in try catch block
    function wrapInTryCatch() {
        initializeRefactoringSession();
        _wrapSelectedStatements(TRY_CATCH, Strings.ERROR_TRY_CATCH);
    }

    //Wrap selected statements in try condition
    function wrapInCondition() {
        initializeRefactoringSession();
        _wrapSelectedStatements(WRAP_IN_CONDITION, Strings.ERROR_WRAP_IN_CONDITION);
    }

    //Convert function to arrow function
    function convertToArrowFunction() {
        initializeRefactoringSession();
        //Handle when there is no selected line
        var funcExprNode = current.findSurroundASTNode(current.ast, {start: current.startIndex}, ["FunctionExpression"]);

        if (!funcExprNode || funcExprNode.type !== "FunctionExpression" || funcExprNode.id) {
            current.editor.displayErrorMessageAtCursor(Strings.ERROR_ARROW_FUNCTION);
            return;
        }
        var noOfStatements = funcExprNode.body.body.length,
            selectedText = current.text.substr(funcExprNode.start, funcExprNode.end - funcExprNode.start),
            param = current.getParamsOfFunction(funcExprNode.start, funcExprNode.end, selectedText),
            loc = {
                "fullFunctionScope": {
                    start: funcExprNode.start,
                    end: funcExprNode.end
                },
                "functionsDeclOnly": {
                    start: funcExprNode.start,
                    end: funcExprNode.body.start
                }
            },
            locPos = {
                "fullFunctionScope": {
                    "start": current.cm.posFromIndex(loc.fullFunctionScope.start),
                    "end": current.cm.posFromIndex(loc.fullFunctionScope.end)
                },
                "functionsDeclOnly": {
                    "start": current.cm.posFromIndex(loc.functionsDeclOnly.start),
                    "end": current.cm.posFromIndex(loc.functionsDeclOnly.end)
                }
            },
            isReturnStatement = funcExprNode.body.body[0].type === "ReturnStatement",
            bodyStatements = funcExprNode.body.body[0],
            params = {
                "params": param.join(", "),
                "statement": _.trimRight(current.text.substr(bodyStatements.start, bodyStatements.end - bodyStatements.start), ";")
            };

        if (isReturnStatement) {
            params.statement = params.statement.substr(7).trim();
        }

        if (noOfStatements === 1) {
            current.document.batchOperation(function() {
                funcExprNode.params.length === 1 ?  current.replaceTextFromTemplate(ARROW_FUNCTION, params, locPos.fullFunctionScope, "oneParamOneStament") :
                current.replaceTextFromTemplate(ARROW_FUNCTION, params, locPos.fullFunctionScope, "manyParamOneStament");

            });
        } else {
            current.document.batchOperation(function() {
                funcExprNode.params.length === 1 ?  current.replaceTextFromTemplate(ARROW_FUNCTION, {params: param},
                locPos.functionsDeclOnly, "oneParamManyStament") :
                current.replaceTextFromTemplate(ARROW_FUNCTION, {params: param.join(", ")}, locPos.functionsDeclOnly, "manyParamManyStament");
            });
        }

        current.editor.setCursorPos(locPos.functionsDeclOnly.end.line, locPos.functionsDeclOnly.end.ch, false);
    }

    // Create gtteres and setters for a property
    function createGettersAndSetters() {
        initializeRefactoringSession();

        var startIndex = current.startIndex,
            endIndex = current.endIndex,
            selectedText = current.selectedText;

        if (selectedText.length >= 1) {
            var selectionDetails = current.normalizeText(selectedText, startIndex, endIndex);
            selectedText = selectionDetails.text;
            startIndex = selectionDetails.start;
            endIndex = selectionDetails.end;
        }

        var token = TokenUtils.getTokenAt(current.cm, current.cm.posFromIndex(endIndex)),
            isLastNode,
            lineEndPos,
            templateParams;

        //Create getters and setters only if selected reference is a property
        if (token.type !== "property") {
            current.editor.displayErrorMessageAtCursor(Strings.ERROR_GETTERS_SETTERS);
            return;
        }

        // Check if selected propery is child of a object expression
        if (!current.getParentNode(current.ast, endIndex)) {
            current.editor.displayErrorMessageAtCursor(Strings.ERROR_GETTERS_SETTERS);
            return;
        }

        //We have to add ',' so we need to find position of current property selected
        isLastNode = current.isLastNodeInScope(current.ast, endIndex);
        lineEndPos = current.lineEndPosition(current.startPos.line);
        templateParams = {
            "getName": "get" + token.string,
            "setName": "set" + token.string,
            "tokenName": token.string
        };

        // Replace, setSelection, IndentLine
        // We need to call batchOperation as indentLine don't have option to add origin as like replaceRange
        current.document.batchOperation(function() {
            if (isLastNode) {
                //Add ',' in the end of current line
                current.document.replaceRange(",", lineEndPos, lineEndPos);
                lineEndPos.ch++;
            }

            current.editor.setSelection(lineEndPos); //Selection on line end

            // Add getters and setters for given token using template at current cursor position
            current.replaceTextFromTemplate(GETTERS_SETTERS, templateParams);

            if (!isLastNode) {
                // Add ',' at the end setter
                current.document.replaceRange(",", current.editor.getSelection().start, current.editor.getSelection().start);
            }
        });
    }


    //Register commands and and menus in conext menu and main menus under 'Edit'
    function addCommands() {
        CommandManager.register(Strings.CMD_REFACTORING_TRY_CATCH, refactorWrapInTryCatch, wrapInTryCatch);
        CommandManager.register(Strings.CMD_REFACTORING_CONDITION, refactorWrapInCondition, wrapInCondition);
        CommandManager.register(Strings.CMD_REFACTORING_ARROW_FUNCTION, refactorConvertToArrowFn, convertToArrowFunction);
        CommandManager.register(Strings.CMD_REFACTORING_GETTERS_SETTERS, refactorCreateGetSet, createGettersAndSetters);

        var menuLocation = Menus.AppMenuBar.EDIT_MENU,
            editorCmenu = Menus.getContextMenu(Menus.ContextMenuIds.EDITOR_MENU);

        if (editorCmenu) {
            editorCmenu.addMenuItem(refactorWrapInTryCatch);
            editorCmenu.addMenuItem(refactorWrapInCondition);
            editorCmenu.addMenuItem(refactorConvertToArrowFn);
            editorCmenu.addMenuItem(refactorCreateGetSet);
        }

        Menus.getMenu(menuLocation).addMenuItem(refactorWrapInTryCatch);
        Menus.getMenu(menuLocation).addMenuItem(refactorWrapInCondition);
        Menus.getMenu(menuLocation).addMenuItem(refactorConvertToArrowFn);
        Menus.getMenu(menuLocation).addMenuItem(refactorCreateGetSet);
    }

    exports.addCommands = addCommands;
});